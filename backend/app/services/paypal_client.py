import base64
import time
import logging
from typing import Dict, Any, Optional, Tuple
import httpx
from backend.app.config import settings

logger = logging.getLogger(__name__)

class PayPalClient:
    """
    PayPal Sandbox REST API Client.
    Follows official PayPal Developer Disputes API v1 contract.
    Handles OAuth 2.0 token caching, sanitized logging, and dispute lifecycle actions.
    """

    _cached_token: Optional[str] = None
    _token_expiry_timestamp: float = 0.0

    @classmethod
    def is_configured(cls) -> bool:
        return bool(settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET)

    @classmethod
    async def get_access_token(cls) -> str:
        """
        Retrieves an OAuth 2.0 bearer token using client credentials grant.
        Caches token until 60 seconds prior to expiration.
        """
        now = time.time()
        if cls._cached_token and now < (cls._token_expiry_timestamp - 60):
            return cls._cached_token

        if not cls.is_configured():
            raise ValueError(
                "PayPal sandbox credentials not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
            )

        # Basic Auth header: base64(client_id:client_secret)
        credentials = f"{settings.PAYPAL_CLIENT_ID}:{settings.PAYPAL_CLIENT_SECRET}"
        encoded_creds = base64.b64encode(credentials.encode()).decode()

        headers = {
            "Authorization": f"Basic {encoded_creds}",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        data = {"grant_type": "client_credentials"}

        url = f"{settings.PAYPAL_BASE_URL}/v1/oauth2/token"
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                response = await client.post(url, headers=headers, data=data)
                response.raise_for_status()
                token_data = response.json()
                
                access_token = token_data.get("access_token")
                expires_in = token_data.get("expires_in", 3600)

                cls._cached_token = access_token
                cls._token_expiry_timestamp = now + float(expires_in)
                logger.info("Successfully acquired PayPal Sandbox OAuth 2.0 access token.")
                return access_token
            except httpx.HTTPStatusError as e:
                logger.error(f"PayPal OAuth failed with status {e.response.status_code}: {e.response.text}")
                raise ConnectionError(f"PayPal OAuth authorization failed: {e.response.status_code}")
            except Exception as e:
                logger.error(f"PayPal OAuth network failure: {str(e)}")
                raise ConnectionError(f"Unable to connect to PayPal sandbox: {str(e)}")

    @classmethod
    async def test_connection(cls) -> Tuple[bool, str, Optional[int]]:
        """Verifies sandbox connectivity and credentials by requesting an OAuth token."""
        if not cls.is_configured():
            return False, "PayPal sandbox credentials (PAYPAL_CLIENT_ID / SECRET) are not configured.", None

        try:
            token = await cls.get_access_token()
            if token:
                return True, "Successfully authenticated with PayPal Sandbox REST API.", 200
            return False, "Token response was empty.", 500
        except ConnectionError as e:
            return False, str(e), 401
        except Exception as e:
            return False, f"Unexpected error during connection test: {str(e)}", 500

    @classmethod
    async def get_disputes(cls, page_size: int = 20) -> Dict[str, Any]:
        """Lists disputes from PayPal Sandbox API."""
        token = await cls.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        url = f"{settings.PAYPAL_BASE_URL}/v1/customer/disputes?page_size={page_size}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()

    @classmethod
    async def get_dispute_details(cls, external_dispute_id: str) -> Dict[str, Any]:
        """Retrieves single dispute details from PayPal Sandbox API."""
        token = await cls.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        url = f"{settings.PAYPAL_BASE_URL}/v1/customer/disputes/{external_dispute_id}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.json()

    @classmethod
    async def execute_provide_evidence(
        cls,
        external_dispute_id: str,
        evidence_type: str,
        notes: str,
        tracking_number: Optional[str] = None,
        carrier: Optional[str] = None
    ) -> Dict[str, Any]:
        """Submits evidence to PayPal Sandbox dispute."""
        token = await cls.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        url = f"{settings.PAYPAL_BASE_URL}/v1/customer/disputes/{external_dispute_id}/provide-evidence"
        payload: Dict[str, Any] = {
            "evidence_type": evidence_type or "PROOF_OF_FULFILLMENT",
            "notes": notes or "Investigator submitted tracking evidence verification via ResolveIQ workbench."
        }
        if tracking_number:
            payload["tracking_info"] = [{
                "tracking_number": tracking_number,
                "carrier_name": carrier or "OTHER"
            }]

        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json() if resp.text else {"status": "SUCCESS", "message": "Evidence accepted by PayPal Sandbox."}

    @classmethod
    async def execute_accept_claim(
        cls,
        external_dispute_id: str,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """Accepts a buyer claim in PayPal Sandbox dispute."""
        token = await cls.get_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        url = f"{settings.PAYPAL_BASE_URL}/v1/customer/disputes/{external_dispute_id}/accept-claim"
        payload = {
            "note": notes or "Dispute accepted by merchant investigator following ResolveIQ evidence review."
        }
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            return resp.json() if resp.text else {"status": "SUCCESS", "message": "Claim accepted in PayPal Sandbox."}
