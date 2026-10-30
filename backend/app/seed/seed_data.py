import json
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from backend.app.database import SessionLocal, engine, Base
from backend.app.models.dispute import Dispute, Transaction, Order, Shipment
from backend.app.models.evidence import Evidence
from backend.app.models.brief import HistoricalCase
from backend.app.models.audit import AuditEvent
from backend.app.models.message import DisputeMessage
from backend.app.models.team import AIReview, CaseCollaborator, CaseRequest, Email, Flag, ManagerAlert, Notification, Strike, User
from backend.app.services.priority_service import calculate_priority_score

def _seed_answered_requests(db: Session, dispute_id: str, reason: str, now: datetime) -> None:
    """Gives a case a finished conversation: PayPal asked the seller and the buyer, and each answered. That is what makes it ready to decide."""
    from backend.app.services import evidence_catalog as cat
    asks = {
        "SELLER": (["CARRIER_TRACKING"], "Evidence request to seller", "Please send the carrier tracking for this shipment.", "Carrier tracking attached: the parcel was delivered."),
        "BUYER": (["BUYER_STATEMENT"], "Evidence request to buyer", "Please give us your account of what happened.", "My statement is below. The parcel did not arrive as described."),
    }
    for n, (party, (items, subject, ask, answer)) in enumerate(asks.items()):
        asked_at, answered_at = now - timedelta(days=2, hours=n), now - timedelta(days=1, hours=12 + n)
        out_id, in_id = f"MSG-SEED-{dispute_id[-4:]}-{party[0]}-OUT", f"MSG-SEED-{dispute_id[-4:]}-{party[0]}-IN"
        action = "REQUEST_SELLER_EVIDENCE" if party == "SELLER" else "REQUEST_BUYER_EVIDENCE"
        db.add(DisputeMessage(
            id=out_id, dispute_id=dispute_id, direction="OUTBOUND", counterparty=party, action_type=action, subject=f"{subject} for dispute {dispute_id}", body=ask, source="synthetic",
            awaiting_reply=False, is_read=True, created_at=asked_at, meta_json=json.dumps({"requested_evidence": items, "deadline": (asked_at + timedelta(days=5)).isoformat()})))
        db.add(DisputeMessage(
            id=in_id, dispute_id=dispute_id, direction="INBOUND", counterparty=party, action_type=action, subject=f"Re: {subject} for dispute {dispute_id}", body=answer, source="synthetic",
            awaiting_reply=False, in_reply_to=out_id, is_read=True, created_at=answered_at, meta_json=json.dumps({"provided_evidence": items, "unable_to_provide": []})))
        for t in items:
            db.add(Evidence(id=f"DEMO-EVID-{dispute_id[-4:]}-{party[0]}RQ", dispute_id=dispute_id, evidence_type=t, description=f"Provided by {party.lower()}: {answer}", source="synthetic",
                            submitted_at=answered_at, availability_status="AVAILABLE", metadata_json=json.dumps({"provided_by": party})))


def seed_database(db: Session = None) -> None:
    should_close = False
    if db is None:
        # Create all tables if not exist
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
        should_close = True

    try:
        # Clear existing synthetic demo data, and the oversight records that hang off it. Accounts stay, but start unblocked.
        for model in (Email, Flag, AIReview, Notification, ManagerAlert, Strike, CaseRequest, CaseCollaborator):
            db.query(model).delete()
        db.query(User).update({"is_blocked": False, "blocked_at": None, "blocked_reason": None})
        db.query(Dispute).filter(Dispute.parent_dispute_id.isnot(None)).delete()  # appeals opened during the demo
        db.query(DisputeMessage).filter(DisputeMessage.dispute_id.in_(db.query(Dispute.id).filter(Dispute.source == "synthetic"))).delete(synchronize_session=False)  # every message on a demo case, however it arrived
        db.query(AuditEvent).filter(AuditEvent.source == "synthetic").delete()
        db.query(Evidence).filter(Evidence.source == "synthetic").delete()
        db.query(Dispute).filter(Dispute.source == "synthetic").delete()
        db.query(Shipment).filter(Shipment.source == "synthetic").delete()
        db.query(Order).filter(Order.source == "synthetic").delete()
        db.query(Transaction).filter(Transaction.source == "synthetic").delete()
        db.query(HistoricalCase).filter(HistoricalCase.source == "synthetic").delete()
        db.commit()

        now = datetime.utcnow()

        # ==========================================
        # 1. MAIN DEMO CASE: DEMO-DSP-1042
        # ==========================================
        t_1042 = Transaction(
            id="DEMO-TXN-1042",
            external_transaction_id="TXN-PAYPAL-9871120",
            source="synthetic",
            amount=450.00,
            currency="USD",
            status="COMPLETED",
            transaction_date=now - timedelta(days=6),
            related_order_id="DEMO-ORD-1042",
            payment_method="PAYPAL_BALANCE",
            buyer_email_masked="a***n@example.com"
        )
        db.add(t_1042)

        o_1042 = Order(
            id="DEMO-ORD-1042",
            external_order_id="ORD-TECH-8921",
            source="synthetic",
            item_summary="UltraSound Wireless Noise-Cancelling Headphones (Midnight Black)",
            order_date=now - timedelta(days=6, hours=1),
            amount=450.00,
            currency="USD",
            merchant_reference="TechStore"
        )
        db.add(o_1042)

        s_1042 = Shipment(
            id="DEMO-SHIP-1042",
            order_id="DEMO-ORD-1042",
            source="synthetic",
            tracking_reference="1Z9999999999999999",
            status="DELIVERED",
            carrier="UPS",
            shipped_at=now - timedelta(days=5),
            delivered_at=now - timedelta(days=2),
            delivery_address_match="unknown",
            shipping_address_masked="452 Elm St, Apt 3B, Springfield, IL 62701",
            destination_city="Springfield, IL"
        )
        db.add(s_1042)

        d_1042 = Dispute(
            id="DEMO-DSP-1042",
            external_dispute_id="PP-D-8821941",
            source="synthetic",
            transaction_id="DEMO-TXN-1042",
            order_id="DEMO-ORD-1042",
            buyer_reference="Alex Morgan (alex_m_demo)",
            merchant_reference="TechStore",
            reason="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            status="OPEN",
            amount=450.00,
            currency="USD",
            response_due_date=now + timedelta(days=2, hours=4),
            created_at=now - timedelta(days=1),
            updated_at=now - timedelta(hours=6),
            buyer_claim="The item never arrived. Front porch camera shows no carrier delivery at stated time.",
            evidence_status="CONFLICTING"
        )
        score, factors = calculate_priority_score(
            amount=d_1042.amount,
            response_due_date=d_1042.response_due_date,
            evidence_status=d_1042.evidence_status,
            delivery_address_match="unknown",
            shipment_status="DELIVERED",
            reason=d_1042.reason
        )
        d_1042.priority_score = score
        d_1042.priority_factors_json = json.dumps([f.model_dump() for f in factors])
        db.add(d_1042)

        e1_1042 = Evidence(
            id="DEMO-EVID-1042-01",
            dispute_id="DEMO-DSP-1042",
            evidence_type="CARRIER_TRACKING",
            description="Carrier tracking shows 'DELIVERED to Front Porch', Springfield, IL.",
            source_record_id="DEMO-SHIP-1042",
            source="synthetic",
            submitted_at=now - timedelta(days=1),
            availability_status="AVAILABLE",
            metadata_json=json.dumps({"carrier": "UPS", "tracking_number": "1Z9999999999999999", "status": "DELIVERED"})
        )
        e2_1042 = Evidence(
            id="DEMO-EVID-1042-02",
            dispute_id="DEMO-DSP-1042",
            evidence_type="PROOF_OF_DELIVERY_SIGNATURE",
            description="Signature on delivery confirmation",
            source_record_id=None,
            source="synthetic",
            submitted_at=None,
            availability_status="MISSING",
            metadata_json=json.dumps({"reason": "No signature requirement requested on shipping label"})
        )
        e3_1042 = Evidence(
            id="DEMO-EVID-1042-03",
            dispute_id="DEMO-DSP-1042",
            evidence_type="ADDRESS_VERIFICATION",
            description="Geocoded GPS coordinate or detailed street match from carrier portal",
            source_record_id=None,
            source="synthetic",
            submitted_at=None,
            availability_status="MISSING",
            metadata_json=json.dumps({"reason": "Carrier API reports postal code level confirmation only"})
        )
        e4_1042 = Evidence(
            id="DEMO-EVID-1042-04",
            dispute_id="DEMO-DSP-1042",
            evidence_type="MERCHANT_CORRESPONDENCE",
            description="Pre-dispute customer service emails between TechStore and Alex Morgan",
            source_record_id=None,
            source="synthetic",
            submitted_at=None,
            availability_status="MISSING",
            metadata_json=json.dumps({"reason": "Merchant CRM integration not yet connected or logs missing"})
        )
        db.add_all([e1_1042, e2_1042, e3_1042, e4_1042])

        # Audit initial event for DEMO-DSP-1042
        audit_1042 = AuditEvent(
            id="DEMO-AUDIT-1042-01",
            dispute_id="DEMO-DSP-1042",
            actor="paypal_webhook_simulator",
            action="DISPUTE_INGESTED",
            status="SUCCESS",
            source="synthetic",
            request_reference="WH-EVT-77218",
            result_summary="Dispute ingested with status OPEN (Decide within 52 hrs)",
            created_at=now - timedelta(days=1)
        )
        db.add(audit_1042)

        # ==========================================
        # 2. ADDITIONAL 11 SYNTHETIC DISPUTES (Total 12)
        # ==========================================
        cases_def = [
            {
                "id": "DEMO-DSP-1043",
                "buyer": "Jordan Lee (jlee_synthetic)",
                "merchant": "GadgetVerse",
                "item": "ProCam 4K Drone Bundle with Extra Battery",
                "amount": 899.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "UNDER_REVIEW",
                "due_hours": 36,
                "buyer_claim": "The item arrived with severe water damage and the sensor is inoperable.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "FedEx",
                "evidence_type": "PHOTO_PROOF",
                "evidence_desc": "Buyer uploaded 3 high-resolution photos of internal water condensation in lens."
            },
            {
                "id": "DEMO-DSP-1044",
                "buyer": "Taylor Swift (tswift_fan_fictional)",
                "merchant": "AudioDirect",
                "item": "Studio Monitor Speakers (Pair)",
                "amount": 320.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 12,
                "buyer_claim": "Never received package. Tracking stuck in transit for 18 days.",
                "evidence_status": "MISSING",
                "tracking_status": "IN_TRANSIT",
                "addr_match": "unknown",
                "carrier": "USPS",
                "evidence_type": "CARRIER_TRACKING",
                "evidence_desc": "Tracking status shows In Transit, Arriving Late in regional distribution hub."
            },
            {
                "id": "DEMO-DSP-1045",
                "buyer": "Carlos Mendez (cmendez_demo)",
                "merchant": "TechStore",
                "item": "Ergonomic Mechanical Keyboard (RGB)",
                "amount": 149.99,
                "reason": "UNAUTHORISED",
                "status": "OPEN",
                "due_hours": 72,
                "buyer_claim": "Account compromised. I did not place this order from this IP address.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "USPS",
                "evidence_type": "IP_AND_DEVICE_LOG",
                "evidence_desc": "Checkout IP matches historical login IP from previous 4 successful purchases."
            },
            {
                "id": "DEMO-DSP-1046",
                "buyer": "Elena Rostova (erostova_synthetic)",
                "merchant": "EliteWatches",
                "item": "Chronograph Automatic Watch Sapphire Edition",
                "amount": 1250.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "OPEN",
                "due_hours": 18,
                "buyer_claim": "Serial number does not match manufacturer warranty database. Suspected counterfeit.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "DHL_EXPRESS",
                "evidence_type": "APPRAISAL_LETTER",
                "evidence_desc": "Local jeweler written assessment claiming non-authentic movement components."
            },
            {
                "id": "DEMO-DSP-1047",
                "buyer": "Marcus Vance (mvance_demo)",
                "merchant": "NordicFootwear",
                "item": "Winter All-Weather Trail Boots (Size 10)",
                "amount": 180.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "RESOLVED",
                "due_hours": -24,  # Closed
                "buyer_claim": "Package stolen from mail room.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "FedEx",
                "evidence_type": "PROOF_OF_DELIVERY_SIGNATURE",
                "evidence_desc": "Direct signature obtained with photo of recipient at door."
            },
            {
                "id": "DEMO-DSP-1048",
                "buyer": "Sophia Patel (spatel_demo)",
                "merchant": "TechStore",
                "item": "USB-C Dual 4K Monitor Docking Station",
                "amount": 210.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 6,  # Imminent deadline!
                "buyer_claim": "Carrier marked delivered but left at wrong street number.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "no",
                "carrier": "UPS",
                "evidence_type": "GPS_COORDINATES",
                "evidence_desc": "Carrier scan geotag shows delivery scan occurred 2.4 miles from buyer billing zip."
            },
            {
                "id": "DEMO-DSP-1049",
                "buyer": "David Kim (dkim_demo)",
                "merchant": "GearHub",
                "item": "Carbon Fiber Road Bike Helmet (M)",
                "amount": 165.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "UNDER_REVIEW",
                "due_hours": 96,
                "buyer_claim": "Wrong color delivered: received Neon Yellow instead of Matte Black.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "USPS",
                "evidence_type": "PRODUCT_PHOTO",
                "evidence_desc": "Photo of unopened retail box clearly shows SKU for Neon Yellow colorway."
            },
            {
                "id": "DEMO-DSP-1050",
                "buyer": "Amina Al-Mansoor (amina_m_demo)",
                "merchant": "LuxeLiving",
                "item": "Egyptian Cotton Percale Sheet Set (King)",
                "amount": 280.00,
                "reason": "CANCELLED_OR_RETURNED",
                "status": "OPEN",
                "due_hours": 48,
                "buyer_claim": "Returned package according to merchant return instructions 10 days ago. Refund not received.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "USPS",
                "evidence_type": "RETURN_CARRIER_TRACKING",
                "evidence_desc": "Return tracking number shows arrival at merchant fulfillment center warehouse."
            },
            {
                "id": "DEMO-DSP-1051",
                "buyer": "Liam O'Connor (loconnor_demo)",
                "merchant": "TechStore",
                "item": "Gaming Graphics Card RTX 4070 OC",
                "amount": 599.99,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 15,  # Imminent high amount
                "buyer_claim": "Box arrived empty, sealed with clear tape. Graphics card missing.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "FedEx",
                "evidence_type": "WEIGHT_VERIFICATION",
                "evidence_desc": "FedEx manifest weight recorded as 4.2 lbs at origin hub, 1.1 lbs at delivery scan."
            },
            {
                "id": "DEMO-DSP-1052",
                "buyer": "Rachel Green (rgreen_demo)",
                "merchant": "UrbanThreads",
                "item": "Vintage Washed Denim Jacket (S)",
                "amount": 95.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "CLOSED",
                "due_hours": -72,
                "buyer_claim": "Never showed up.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "USPS",
                "evidence_type": "DELIVERY_CONFIRMATION",
                "evidence_desc": "Signed for by building receptionist."
            },
            {
                "id": "DEMO-DSP-1053",
                "buyer": "Brandon Cole (bcole_demo)",
                "merchant": "TechStore",
                "item": "Smart WiFi Mesh System (3-Pack)",
                "amount": 299.99,
                "reason": "DUPLICATE_TRANSACTION",
                "status": "OPEN",
                "due_hours": 80,
                "buyer_claim": "Card was billed twice for the same single order item within 3 minutes.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "UPS",
                "evidence_type": "TRANSACTION_LOG",
                "evidence_desc": "Payment gateway log shows two authorizations with identical order ID."
            },
            {
                "id": "DEMO-DSP-1054",
                "buyer": "Maya Patel (maya_patel_demo)",
                "merchant": "StreamBox",
                "item": "Annual Streaming Plan",
                "amount": 119.88,
                "reason": "CANCELLED_OR_RETURNED",
                "status": "OPEN",
                "due_hours": 70,
                "buyer_claim": "I cancelled the subscription in March and was still charged for the whole year.",
                "evidence_status": "MISSING",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "Digital",
                "evidence_type": "SUBSCRIPTION_LOG",
                "evidence_desc": "Account log shows the cancel request on 14 March and a renewal charge on 2 April."
            },
            {
                "id": "DEMO-DSP-1055",
                "buyer": "Daniel Okafor (dokafor_demo)",
                "merchant": "LuxeVault",
                "item": "Designer Leather Handbag",
                "amount": 1850.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "OPEN",
                "due_hours": 30,
                "buyer_claim": "The bag is a fake. The stitching is wrong and the serial plate does not match the brand's.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "FedEx",
                "evidence_type": "PHOTO_PROOF",
                "evidence_desc": "Buyer uploaded 6 photos comparing the serial plate and stitching with the brand's authentic sample."
            },
            {
                "id": "DEMO-DSP-1056",
                "buyer": "Chloe Martin (chloe_m_demo)",
                "merchant": "TicketHub",
                "item": "Two Concert Tickets, Row F",
                "amount": 640.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 90,
                "buyer_claim": "The tickets were never delivered to my account and the venue says the barcodes are invalid.",
                "evidence_status": "MISSING",
                "tracking_status": "DELIVERED",
                "addr_match": "unknown",
                "carrier": "Digital",
                "evidence_type": "TRANSACTION_LOG",
                "evidence_desc": "Delivery log shows the e-tickets were emailed once and the barcodes were reissued twice since."
            },
            {
                "id": "DEMO-DSP-1057",
                "buyer": "Ethan Brooks (ebrooks_demo)",
                "merchant": "NorthWind Outdoor",
                "item": "Four-Season Tent",
                "amount": 185.0,
                "reason": "CANCELLED_OR_RETURNED",
                "status": "OPEN",
                "due_hours": 60,
                "buyer_claim": "It arrived three weeks late so I cancelled and sent it back. No refund yet.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "UPS",
                "evidence_type": "RETURN_CARRIER_TRACKING",
                "evidence_desc": "Return label scanned at the carrier 9 days ago; the warehouse has not logged receipt."
            },
            {
                "id": "DEMO-DSP-1058",
                "buyer": "Sofia Rossi (sofia_r_demo)",
                "merchant": "StrideShoes",
                "item": "Running Shoes, Size 8",
                "amount": 145.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "OPEN",
                "due_hours": 110,
                "buyer_claim": "I ordered size 8 and got size 6. The seller says returns are not accepted on sale items.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "USPS",
                "evidence_type": "MERCHANT_CORRESPONDENCE",
                "evidence_desc": "Messages show the seller refusing the return and quoting a policy not on the listing."
            },
            {
                "id": "DEMO-DSP-1059",
                "buyer": "Marcus Lee (mlee_demo)",
                "merchant": "CryptoGear",
                "item": "Hardware Wallet Pro",
                "amount": 2400.0,
                "reason": "UNAUTHORISED",
                "status": "OPEN",
                "due_hours": 14,
                "buyer_claim": "I did not order this. My account was used from a device I do not own.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "no",
                "carrier": "DHL",
                "evidence_type": "IP_AND_DEVICE_LOG",
                "evidence_desc": "Login came from a new device in another country 20 minutes before the order was placed."
            },
            {
                "id": "DEMO-DSP-1060",
                "buyer": "Priya Nair (pnair_demo)",
                "merchant": "HomeBuild Supply",
                "item": "Three-Piece Shelving Set",
                "amount": 410.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 50,
                "buyer_claim": "Only two of the three shelves came. The box was labelled 3 of 3.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "FedEx",
                "evidence_type": "CARRIER_TRACKING",
                "evidence_desc": "Carrier shows one parcel delivered. The order was shipped as three separate parcels."
            },
            {
                "id": "DEMO-DSP-1061",
                "buyer": "Oliver Grant (ogrant_demo)",
                "merchant": "PetPlanet",
                "item": "Automatic Pet Feeder",
                "amount": 275.0,
                "reason": "CANCELLED_OR_RETURNED",
                "status": "UNDER_REVIEW",
                "due_hours": 40,
                "buyer_claim": "I returned it two weeks ago as instructed and was promised a refund that never came.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "UPS",
                "evidence_type": "RETURN_CARRIER_TRACKING",
                "evidence_desc": "Return tracking shows delivery to the seller's warehouse, signed for by a staff member."
            },
            {
                "id": "DEMO-DSP-1062",
                "buyer": "Hannah Weiss (hweiss_demo)",
                "merchant": "TechBazaar",
                "item": "15-inch Laptop, 32GB RAM",
                "amount": 1320.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "OPEN",
                "due_hours": 24,
                "buyer_claim": "The listing said 32GB RAM and a newer processor. The laptop has 16GB and an older chip.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "UPS",
                "evidence_type": "PHOTO_PROOF",
                "evidence_desc": "Buyer's system information screen shows 16GB RAM and the previous-generation processor."
            },
            {
                "id": "DEMO-DSP-1063",
                "buyer": "Ravi Menon (rmenon_demo)",
                "merchant": "PixelCraft Studio",
                "item": "Brand Identity Package",
                "amount": 520.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 100,
                "buyer_claim": "The designer took the money and never sent the logo files after the first draft.",
                "evidence_status": "MISSING",
                "tracking_status": "DELIVERED",
                "addr_match": "unknown",
                "carrier": "Digital",
                "evidence_type": "MERCHANT_CORRESPONDENCE",
                "evidence_desc": "Message thread shows one draft sent, then no reply for 18 days."
            },
            {
                "id": "DEMO-DSP-1064",
                "buyer": "Grace Kim (grace_k_demo)",
                "merchant": "StreamBox",
                "item": "Premium Plan, Monthly",
                "amount": 59.0,
                "reason": "DUPLICATE_TRANSACTION",
                "status": "OPEN",
                "due_hours": 85,
                "buyer_claim": "I was charged for the monthly plan twice on the same day.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "Digital",
                "evidence_type": "TRANSACTION_LOG",
                "evidence_desc": "Billing log shows two renewals 40 seconds apart under the same subscription."
            },
            {
                "id": "DEMO-DSP-1065",
                "buyer": "Lucas Almeida (lalmeida_demo)",
                "merchant": "BrightHome",
                "item": "Espresso Machine",
                "amount": 230.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "OPEN",
                "due_hours": 8,
                "buyer_claim": "The tracking says delivered but it was left with a neighbour I do not know.",
                "evidence_status": "CONFLICTING",
                "tracking_status": "DELIVERED",
                "addr_match": "no",
                "carrier": "USPS",
                "evidence_type": "GPS_COORDINATES",
                "evidence_desc": "Delivery scan is 140 metres from the shipping address, on a different street."
            },
            {
                "id": "DEMO-DSP-1066",
                "buyer": "Amelia Shaw (ashaw_demo)",
                "merchant": "Oak & Iron Furniture",
                "item": "Solid Oak Dining Table",
                "amount": 760.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "OPEN",
                "due_hours": 44,
                "buyer_claim": "The table arrived with a deep crack across the top. The box was crushed on one corner.",
                "evidence_status": "PARTIAL",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "XPO Logistics",
                "evidence_type": "PHOTO_PROOF",
                "evidence_desc": "Buyer photos show a crushed corner on the carton and a crack running across the table top."
            },
            {
                "id": "DEMO-DSP-1067",
                "buyer": "Noah Fischer (nfischer_demo)",
                "merchant": "GameVault",
                "item": "Gift Card, 100 USD",
                "amount": 100.0,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "status": "RESOLVED",
                "due_hours": -30,
                "buyer_claim": "The gift card code was already used when I tried to redeem it.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "Digital",
                "evidence_type": "TRANSACTION_LOG",
                "evidence_desc": "Issuer log shows the code was redeemed 6 minutes before the buyer's first attempt, from another account."
            },
            {
                "id": "DEMO-DSP-1069",
                "buyer": "Marcus Bell (mbell_demo)",
                "merchant": "NorthPeak Outfitters",
                "item": "Insulated Hiking Jacket (L)",
                "amount": 240.00,
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "status": "UNDER_REVIEW",
                "due_hours": 60,
                "buyer_claim": "I never got my jacket. The tracking says delivered but nothing came.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "UPS",
                "evidence_type": "PROOF_OF_DELIVERY_SIGNATURE",
                "evidence_desc": "Delivery signed for by M. Bell at the address on the order."
            },
            {
                "id": "DEMO-DSP-1068",
                "buyer": "Isabel Torres (itorres_demo)",
                "merchant": "SunWear",
                "item": "Linen Summer Dress",
                "amount": 89.0,
                "reason": "CANCELLED_OR_RETURNED",
                "status": "CLOSED",
                "due_hours": -50,
                "buyer_claim": "I sent the dress back within the return window and the seller kept the money.",
                "evidence_status": "COMPLETE",
                "tracking_status": "DELIVERED",
                "addr_match": "yes",
                "carrier": "USPS",
                "evidence_type": "RETURN_CARRIER_TRACKING",
                "evidence_desc": "Return delivered to the seller 12 days ago. No refund was issued."
            }
        ]

        for idx, c in enumerate(cases_def):
            txn_id = f"DEMO-TXN-{1043+idx}"
            ord_id = f"DEMO-ORD-{1043+idx}"
            ship_id = f"DEMO-SHIP-{1043+idx}"
            evid_id = f"DEMO-EVID-{1043+idx}-01"

            txn = Transaction(
                id=txn_id,
                external_transaction_id=f"TXN-PP-{700000+idx}",
                source="synthetic",
                amount=c["amount"],
                currency="USD",
                status="COMPLETED",
                transaction_date=now - timedelta(days=7),
                related_order_id=ord_id,
                payment_method="PAYPAL_ACCOUNT",
                buyer_email_masked=f"demo_user_{idx}@example.com"
            )
            db.add(txn)

            ord_obj = Order(
                id=ord_id,
                external_order_id=f"ORD-{c['merchant'].upper()}-{1000+idx}",
                source="synthetic",
                item_summary=c["item"],
                order_date=now - timedelta(days=7, hours=2),
                amount=c["amount"],
                currency="USD",
                merchant_reference=c["merchant"]
            )
            db.add(ord_obj)

            ship_obj = Shipment(
                id=ship_id,
                order_id=ord_id,
                source="synthetic",
                tracking_reference=f"TRK{c['carrier'][:3]}{990000+idx}",
                status=c["tracking_status"],
                carrier=c["carrier"],
                shipped_at=now - timedelta(days=6),
                delivered_at=now - timedelta(days=3) if c["tracking_status"] == "DELIVERED" else None,
                delivery_address_match=c["addr_match"],
                shipping_address_masked=f"10{idx} Market St, Unit {idx+1}, Metro City, USA",
                destination_city="Metro City"
            )
            db.add(ship_obj)

            due_date = now + timedelta(hours=c["due_hours"]) if c["due_hours"] > 0 else now + timedelta(hours=c["due_hours"])
            
            dsp = Dispute(
                id=c["id"],
                external_dispute_id=f"PP-D-{650000+idx}",
                source="synthetic",
                transaction_id=txn_id,
                order_id=ord_id,
                buyer_reference=c["buyer"],
                merchant_reference=c["merchant"],
                reason=c["reason"],
                status=c["status"],
                outcome={"RESOLVED": "SELLER_FAVOR", "CLOSED": "BUYER_FAVOR"}.get(c["status"]),
                amount=c["amount"],
                currency="USD",
                response_due_date=due_date,
                created_at=due_date - timedelta(days=5),   # every case has 5 days
                updated_at=now - timedelta(hours=12),
                buyer_claim=c["buyer_claim"],
                evidence_status=c["evidence_status"]
            )
            score, factors = calculate_priority_score(
                amount=dsp.amount,
                response_due_date=dsp.response_due_date,
                evidence_status=dsp.evidence_status,
                delivery_address_match=c["addr_match"],
                shipment_status=c["tracking_status"],
                reason=dsp.reason
            )
            dsp.priority_score = score
            dsp.priority_factors_json = json.dumps([f.model_dump() for f in factors])
            db.add(dsp)

            evid = Evidence(
                id=evid_id,
                dispute_id=c["id"],
                evidence_type=c["evidence_type"],
                description=c["evidence_desc"],
                source_record_id=ship_id if "CARRIER" in c["evidence_type"] else None,
                source="synthetic",
                submitted_at=now - timedelta(days=1),
                availability_status="AVAILABLE",
                metadata_json=json.dumps({"detail": c["evidence_desc"]})
            )
            db.add(evid)

            audit_evt = AuditEvent(
                id=f"DEMO-AUDIT-{1043+idx}-01",
                dispute_id=c["id"],
                actor="system_scheduler",
                action="PRIORITY_SCORED",
                status="SUCCESS",
                source="synthetic",
                request_reference=f"AUTO-SCORE-{1043+idx}",
                result_summary=f"Automated priority score computed: {score:.1f}/100",
                created_at=now - timedelta(days=1)
            )
            db.add(audit_evt)

            # A case that starts out "Ready to decide" must have earned it: both the seller and the buyer were asked and have answered.
            if c["status"] == "UNDER_REVIEW":
                _seed_answered_requests(db, c["id"], c["reason"], now)

        # ==========================================
        # 3. 20 SYNTHETIC HISTORICAL CASES
        # ==========================================
        historical_cases_data = [
            {
                "id": "HIST-CASE-201",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "INR claim where carrier tracking showed delivered, but signature was absent and GPS coordinates indicated neighboring block.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "signature_obtained": False,
                    "address_match": "no",
                    "merchant_correspondence": True
                },
                "outcome": "BUYER_FAVOR",
                "amount": 340.00,
                "keywords": "item not received tracking delivered missing signature misdelivery gps"
            },
            {
                "id": "HIST-CASE-202",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "INR claim with valid carrier tracking delivered to exact buyer zip code and signature matched buyer surname.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "signature_obtained": True,
                    "address_match": "yes",
                    "merchant_correspondence": True
                },
                "outcome": "MERCHANT_FAVOR",
                "amount": 420.00,
                "keywords": "item not received delivered signature verified address match"
            },
            {
                "id": "HIST-CASE-203",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "INR claim where tracking showed delivered, address verification unknown, merchant provided invoice but no signature.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "signature_obtained": False,
                    "address_match": "unknown",
                    "merchant_correspondence": False
                },
                "outcome": "SETTLED",
                "amount": 450.00,
                "keywords": "item not received delivered unknown address no signature alex morgan similar"
            },
            {
                "id": "HIST-CASE-204",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "case_summary": "SNAD claim alleging damaged electronics; merchant failed to respond within PayPal 10-day window.",
                "evidence_attributes": {
                    "buyer_photos": True,
                    "merchant_response_timely": False,
                    "return_label_offered": False
                },
                "outcome": "BUYER_FAVOR",
                "amount": 290.00,
                "keywords": "damaged electronics expired deadline no merchant response"
            },
            {
                "id": "HIST-CASE-205",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "case_summary": "SNAD claim where buyer submitted verified third-party appraisal confirming non-authentic luxury watch.",
                "evidence_attributes": {
                    "appraisal_letter": True,
                    "return_shipping_completed": True,
                    "merchant_rebuttal": False
                },
                "outcome": "BUYER_FAVOR",
                "amount": 1200.00,
                "keywords": "counterfeit luxury watch appraisal return shipment"
            },
            {
                "id": "HIST-CASE-206",
                "reason": "UNAUTHORISED",
                "case_summary": "Unauthorized transaction claim where billing and shipping address matched 3-year verified PayPal account history.",
                "evidence_attributes": {
                    "ip_match": True,
                    "shipping_address_matches_profile": True,
                    "two_factor_authenticated": True
                },
                "outcome": "MERCHANT_FAVOR",
                "amount": 180.00,
                "keywords": "unauthorized account takeover verified device 2fa matched profile"
            },
            {
                "id": "HIST-CASE-207",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "INR claim with tracking stuck in customs clearing facility for over 21 days past promised delivery window.",
                "evidence_attributes": {
                    "tracking_status": "IN_TRANSIT",
                    "customs_delay": True,
                    "merchant_insurance_filed": True
                },
                "outcome": "BUYER_FAVOR",
                "amount": 310.00,
                "keywords": "customs delay lost package in transit carrier fault"
            },
            {
                "id": "HIST-CASE-208",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "case_summary": "Buyer claimed clothing color difference; merchant product page had clear disclaimer and buyer refused return.",
                "evidence_attributes": {
                    "buyer_photos": True,
                    "merchant_disclaimer_proven": True,
                    "buyer_refused_return": True
                },
                "outcome": "MERCHANT_FAVOR",
                "amount": 85.00,
                "keywords": "minor color variance buyer refused return merchant policy"
            },
            {
                "id": "HIST-CASE-209",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "Package delivered to concierge mailroom with building sign-off log provided by carrier.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "mailroom_signature": True,
                    "address_match": "yes"
                },
                "outcome": "MERCHANT_FAVOR",
                "amount": 510.00,
                "keywords": "mailroom delivery concierge apartment complex signature"
            },
            {
                "id": "HIST-CASE-210",
                "reason": "CANCELLED_OR_RETURNED",
                "case_summary": "Buyer returned goods using trackable return service; warehouse received parcel but refund was delayed.",
                "evidence_attributes": {
                    "return_delivered": True,
                    "warehouse_inspection_pass": True,
                    "refund_unprocessed": True
                },
                "outcome": "BUYER_FAVOR",
                "amount": 260.00,
                "keywords": "return received warehouse delay unissued refund"
            },
            {
                "id": "HIST-CASE-211",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "High-value laptop claimed INR; carrier weight log confirmed box had 0.2 lbs weight upon dispatch.",
                "evidence_attributes": {
                    "weight_discrepancy": True,
                    "empty_box": True,
                    "police_report_filed": True
                },
                "outcome": "BUYER_FAVOR",
                "amount": 1450.00,
                "keywords": "empty box weight discrepancy fraud origin shipping theft"
            },
            {
                "id": "HIST-CASE-212",
                "reason": "DUPLICATE_TRANSACTION",
                "case_summary": "Double charge caused by shopping cart gateway timeout; second charge refunded by merchant directly.",
                "evidence_attributes": {
                    "gateway_duplicate_confirmed": True,
                    "settlement_receipt": True
                },
                "outcome": "SETTLED",
                "amount": 220.00,
                "keywords": "duplicate transaction double billing gateway retry"
            },
            {
                "id": "HIST-CASE-213",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "Delivery confirmation showed package left on porch in high-theft area; porch camera showed porch pirate theft 10 mins post-drop.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "police_report": True,
                    "porch_theft_video": True,
                    "insurance_claim": True
                },
                "outcome": "SETTLED",
                "amount": 395.00,
                "keywords": "porch pirate carrier delivered police report insurance settlement"
            },
            {
                "id": "HIST-CASE-214",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "case_summary": "Buyer received refurbished unit instead of advertised brand new factory-sealed product.",
                "evidence_attributes": {
                    "manufacturer_refurb_sticker": True,
                    "merchant_listing_new": True
                },
                "outcome": "BUYER_FAVOR",
                "amount": 380.00,
                "keywords": "refurbished sold as new misrepresentation condition"
            },
            {
                "id": "HIST-CASE-215",
                "reason": "UNAUTHORISED",
                "case_summary": "Stolen credit card used with freight forwarder address flagged on international watch list.",
                "evidence_attributes": {
                    "freight_forwarder": True,
                    "cardholder_affidavit": True,
                    "ip_geo_mismatch": True
                },
                "outcome": "BUYER_FAVOR",
                "amount": 820.00,
                "keywords": "freight forwarder compromised credit card fraudulent shipping"
            },
            {
                "id": "HIST-CASE-216",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "Merchant provided valid tracking with delivery to matching zip code; buyer claim was filed 60 days after delivery.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "untimely_claim": True,
                    "address_match": "yes"
                },
                "outcome": "DISMISSED",
                "amount": 115.00,
                "keywords": "untimely claim late dispute submission tracking delivered"
            },
            {
                "id": "HIST-CASE-217",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "case_summary": "Cosmetic scratch on back casing of tablet; merchant offered 25% courtesy refund which buyer accepted.",
                "evidence_attributes": {
                    "minor_defect": True,
                    "partial_refund_negotiated": True
                },
                "outcome": "SETTLED",
                "amount": 400.00,
                "keywords": "partial refund cosmetic defect mutual settlement"
            },
            {
                "id": "HIST-CASE-218",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "Delivery attempted 3 times; buyer failed to pick up at postal depot before return to sender.",
                "evidence_attributes": {
                    "delivery_attempts_logged": 3,
                    "unclaimed_parcel": True,
                    "returned_to_merchant": True
                },
                "outcome": "SETTLED",
                "amount": 175.00,
                "keywords": "unclaimed parcel return to sender failed delivery attempts"
            },
            {
                "id": "HIST-CASE-219",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                "case_summary": "High value sound system; merchant purchased full signature verification; signature confirmed matching resident.",
                "evidence_attributes": {
                    "tracking_status": "DELIVERED",
                    "signature_verified": True,
                    "address_match": "yes"
                },
                "outcome": "MERCHANT_FAVOR",
                "amount": 750.00,
                "keywords": "audio electronics adult signature confirmed delivery merchant favor"
            },
            {
                "id": "HIST-CASE-220",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                "case_summary": "Software license key delivered by email; buyer claimed key was invalid, publisher verified key was activated 2 hours prior to dispute.",
                "evidence_attributes": {
                    "digital_goods": True,
                    "activation_log_proven": True
                },
                "outcome": "MERCHANT_FAVOR",
                "amount": 199.00,
                "keywords": "digital goods license activation proof buyer fraud"
            }
        ]

        for h in historical_cases_data:
            hist_obj = HistoricalCase(
                id=h["id"],
                source="synthetic",
                reason=h["reason"],
                case_summary=h["case_summary"],
                evidence_attributes_json=json.dumps(h["evidence_attributes"]),
                outcome=h["outcome"],
                created_at=now - timedelta(days=30),
                amount=h["amount"],
                currency="USD",
                similarity_keywords=h["keywords"]
            )
            db.add(hist_obj)

        db.flush()
        # High-profile open cases go to the manager (PayPal). The rest are shared between the three investigators, so everyone has work.
        from backend.app.services.high_profile import is_high_profile
        team = ["Abhinav Chitturi", "Susmitha", "Jahnavi"]
        mine = 0
        keep_unassigned = {"DEMO-DSP-1056", "DEMO-DSP-1058", "DEMO-DSP-1063", "DEMO-DSP-1065"}   # new arrivals nobody has taken yet, at different stages of their 5 days
        for case in db.query(Dispute).filter(Dispute.status.notin_(["RESOLVED", "CLOSED"])).order_by(Dispute.id).all():
            if case.id == "DEMO-DSP-1069":
                case.assigned_to = "Abhinav Chitturi"   # a clear seller win, ready for the demo of the end-of-case notices
            elif case.id in keep_unassigned:
                case.assigned_to = None
            elif is_high_profile(case):
                case.assigned_to = "PayPal"
            else:
                case.assigned_to = team[mine % len(team)]
                mine += 1

        db.commit()
        print(f"Successfully seeded database with 28 disputes, 20 historical cases, transactions, shipments, and evidence.")

    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
        raise
    finally:
        if should_close:
            db.close()

if __name__ == "__main__":
    seed_database()


# Bump when the meaning of the demo data changes, so databases seeded earlier are refreshed once on startup.
# v2: cases are seen from PayPal's side (OPEN means nobody has been asked for evidence yet).
# v3: cases have an owner (assigned_to).
# v9: cases seeded as Ready to decide now have a real conversation behind them (both sides answered).
# v8: fifteen more cases (subscriptions, counterfeits, tickets, services, partial shipments), some still unassigned.
# v7: every case has a 5-day window and the score rises with the clock.
# v6: high-profile means price only, so who owns what is worked out again.
# v5: three investigators and a manager (PayPal); high-profile cases go to the manager.
# v4: decisions go to the AI reviewer (PENDING_AI_REVIEW), with strikes, alerts and appeals.
SEED_VERSION = "10"


def ensure_seed_current(db: Session) -> str:
    """Seeds an empty database, or re-seeds once if the loaded demo data predates SEED_VERSION. Returns what happened."""
    from backend.app.models.meta import AppMeta

    row = db.get(AppMeta, "seed_version")
    empty = db.query(Dispute).count() == 0
    if not empty and row is not None and row.value == SEED_VERSION:
        return "current"
    seed_database(db)
    db.merge(AppMeta(key="seed_version", value=SEED_VERSION))
    db.commit()
    return "seeded" if empty else "refreshed"
