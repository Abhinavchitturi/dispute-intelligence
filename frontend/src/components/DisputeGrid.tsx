import React, { useMemo } from 'react';
import { AgGridReact, CustomCellRendererProps } from 'ag-grid-react';
import {
  AllCommunityModule, ColDef, colorSchemeDark, GridApi, ModuleRegistry, RowClassParams, RowClickedEvent, themeQuartz, ValueFormatterParams,
} from 'ag-grid-community';
import { Eye } from 'lucide-react';
import { DisputeSummary } from '../types';
import { AssignSelect } from './AssignSelect';
import { Badge } from './ui/kit';
import { EvidenceBadge, StatusBadge } from './ui/StatusBadges';
import { DecideBy, ScoreRing } from './DisputeBits';
import { money, OPEN_STATUSES, reasonLabel, statusMeta } from '../lib/format';

ModuleRegistry.registerModules([AllCommunityModule]);

/** The queue's sort choices, as the grid's starting sort. Clicking a header re-sorts from there. */
export const GRID_SORTS = {
  priority: { colId: 'priority', sort: 'desc', label: 'Most urgent' },
  amount: { colId: 'amount', sort: 'desc', label: 'Highest amount' },
  deadline: { colId: 'due', sort: 'asc', label: 'Soonest deadline' },
} as const;
export type GridSortKey = keyof typeof GRID_SORTS;

// The app's own dark palette (tailwind.config.js), so the grid looks like part of the page.
const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: '#1C1C1E',
  foregroundColor: '#F5F5F7',
  headerBackgroundColor: '#2C2C2E',
  headerTextColor: '#98989F',
  borderColor: '#38383A',
  rowHoverColor: 'rgba(255,255,255,0.03)',
  selectedRowBackgroundColor: 'rgba(10,132,255,0.08)',
  accentColor: '#0A84FF',
  oddRowBackgroundColor: '#1C1C1E',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  fontSize: 13,
  headerFontSize: 12,
  wrapperBorderRadius: 18,
  rowHeight: 68,
  headerHeight: 40,
});

type Ctx = { isManager: boolean; me: string; onQuickView: (id: string) => void };
type Cell = CustomCellRendererProps<DisputeSummary, unknown, Ctx>;

const owner = (d: DisputeSummary, me: string) =>
  d.ai_owned ? 'AI Agent' : d.assigned_to ? (d.assigned_to === me ? 'Yours' : d.assigned_to) : 'Unassigned';

function CaseCell({ data }: Cell) {
  if (!data) return null;
  return (
    <div className="flex h-full min-w-0 flex-col justify-center leading-tight">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-white">{data.id}</span>
        {data.is_high_profile && <Badge tone="warn">High profile</Badge>}
      </div>
      <span className="mt-1 truncate text-xs text-muted">{reasonLabel(data.reason)}</span>
    </div>
  );
}

function PartiesCell({ data }: Cell) {
  if (!data) return null;
  return (
    <div className="flex h-full min-w-0 flex-col justify-center leading-tight" title={data.buyer_claim ?? undefined}>
      <span className="truncate text-slate-200">{data.buyer_reference ?? 'Buyer'} <span className="text-muted">vs {data.merchant_reference ?? 'Seller'}</span></span>
      {data.buyer_claim && <span className="mt-1 truncate text-xs text-muted">“{data.buyer_claim}”</span>}
    </div>
  );
}

function OwnerCell({ data, context }: Cell) {
  if (!data) return null;
  // A manager assigns right in the grid. The click mustn't also open the case.
  if (data.ai_owned && OPEN_STATUSES.includes(data.status)) {
    return (
      <div className="flex h-full flex-col justify-center leading-tight">
        <span className="text-amber-200">AI Agent</span>
        <span className="mt-1 text-xs text-muted">Nobody took it in time.</span>
      </div>
    );
  }
  if (context.isManager && OPEN_STATUSES.includes(data.status)) {
    return <div className="flex h-full items-center" data-no-row-click onClick={(e) => e.stopPropagation()}><AssignSelect disputeId={data.id} assignedTo={data.assigned_to} /></div>;
  }
  const shared = (data.collaborators ?? []).length;
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <span className="text-slate-200">{owner(data, context.me)}</span>
      {shared > 0 && <span className="mt-1 text-xs text-muted">Shared with {data.collaborators.join(', ')}</span>}
    </div>
  );
}

function QuickViewCell({ data, context }: Cell) {
  if (!data) return null;
  return (
    <div className="flex h-full items-center justify-center" data-no-row-click>
      <button
        onClick={(e) => { e.stopPropagation(); context.onQuickView(data.id); }}
        aria-label={`Quick view ${data.id}`} title="Quick view"
        className="rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-white"
      >
        <Eye className="h-4 w-4" />
      </button>
    </div>
  );
}

const centered = (node: React.ReactNode) => <div className="flex h-full items-center">{node}</div>;
const dateValue = (d?: DisputeSummary) => (d?.response_due_date ? new Date(d.response_due_date) : null);

export function DisputeGrid({ rows, isManager, me, openId, sort, onOpenCase, onQuickView, onReady, onShownChange }: {
  rows: DisputeSummary[]; isManager: boolean; me: string; openId: string | null; sort: GridSortKey;
  onOpenCase: (id: string) => void; onQuickView: (id: string) => void; onReady?: (api: GridApi<DisputeSummary>) => void;
  onShownChange?: (shown: number) => void;
}) {
  const columns = useMemo<ColDef<DisputeSummary>[]>(() => {
    const start = GRID_SORTS[sort];
    const sorted = (colId: string) => (start.colId === colId ? start.sort : undefined);
    return [
      { colId: 'priority', headerName: 'Priority', field: 'priority_score', width: 108, filter: 'agNumberColumnFilter', sort: sorted('priority'),
        cellRenderer: ({ data }: Cell) => (data ? centered(<ScoreRing score={data.priority_score} size={38} />) : null) },
      { colId: 'case', headerName: 'Case', field: 'id', minWidth: 214, flex: 1.2, filter: 'agTextColumnFilter',
        filterValueGetter: ({ data }) => `${data?.id ?? ''} ${data ? reasonLabel(data.reason) : ''}`, cellRenderer: CaseCell },
      { colId: 'parties', headerName: 'Buyer vs seller', minWidth: 150, flex: 1, filter: 'agTextColumnFilter',
        valueGetter: ({ data }) => `${data?.buyer_reference ?? 'Buyer'} vs ${data?.merchant_reference ?? 'Seller'} ${data?.buyer_claim ?? ''}`, cellRenderer: PartiesCell },
      // Where the case stands and what evidence is in, stacked, as investigators read them together.
      { colId: 'status', headerName: 'Status', width: 158, filter: 'agTextColumnFilter',
        valueGetter: ({ data }) => (data ? `${statusMeta(data.status).label} · evidence ${data.evidence_status.toLowerCase()}` : ''),
        cellRenderer: ({ data }: Cell) => (data ? (
          <div className="flex h-full flex-col items-start justify-center gap-1"><StatusBadge status={data.status} /><EvidenceBadge status={data.evidence_status} /></div>
        ) : null) },
      { colId: 'amount', headerName: 'Amount', field: 'amount', width: 116, type: 'rightAligned', filter: 'agNumberColumnFilter', sort: sorted('amount'),
        valueFormatter: ({ value, data }: ValueFormatterParams<DisputeSummary, number>) => (value == null ? '' : money(value, data?.currency)),
        cellClass: 'font-semibold tabular-nums text-white' },
      { colId: 'due', headerName: 'Decide by', width: 150, filter: 'agDateColumnFilter', sort: sorted('due'),
        valueGetter: ({ data }) => dateValue(data),
        comparator: (a: Date | null, b: Date | null) => (a?.getTime() ?? Infinity) - (b?.getTime() ?? Infinity),
        cellRenderer: ({ data }: Cell) => (data ? centered(<DecideBy status={data.status} due={data.response_due_date} outcome={data.outcome} />) : null) },
      { colId: 'owner', headerName: 'Owner', width: isManager ? 176 : 140, filter: 'agTextColumnFilter',
        valueGetter: ({ data }) => (data ? owner(data, me) : ''), cellRenderer: OwnerCell },
      { colId: 'view', headerName: '', width: 52, pinned: 'right', sortable: false, filter: false, resizable: false, suppressMovable: true, cellRenderer: QuickViewCell },
    ];
  }, [isManager, me, sort]);

  return (
    <div className="dispute-grid" aria-label="Disputes table">
      <AgGridReact<DisputeSummary>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true, floatingFilter: true, suppressHeaderMenuButton: false, filterParams: { buttons: ['reset'] } }}
        context={{ isManager, me, onQuickView } satisfies Ctx}
        getRowId={({ data }) => data.id}
        domLayout="autoHeight"
        pagination paginationPageSize={20} paginationPageSizeSelector={[20, 50, 100]}
        suppressCellFocus
        animateRows
        getRowClass={({ data }: RowClassParams<DisputeSummary>) => (data && data.id === openId ? 'is-open-row' : undefined)}
        onRowClicked={(e: RowClickedEvent<DisputeSummary>) => {
          // Clicking a dispute opens it in Investigation; the assign box and the quick-view eye do their own thing.
          const target = e.event?.target as HTMLElement | null;
          if (target?.closest('[data-no-row-click], button, select')) return;
          if (e.data) onOpenCase(e.data.id);
        }}
        onGridReady={({ api }) => onReady?.(api)}
        onModelUpdated={({ api }) => onShownChange?.(api.getDisplayedRowCount())}   // after the grid's own column filters
        overlayNoRowsTemplate="No disputes match"
        rowClass="cursor-pointer"
      />
    </div>
  );
}
