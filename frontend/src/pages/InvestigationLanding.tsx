import React from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDisputes } from '../api/client';
import { Skeleton } from '../components/ui/kit';
import { OPEN_STATUSES } from '../lib/format';
import { getLastCase } from '../lib/lastCase';

/** /investigate with no id: back to the case you were last on, or the most urgent open dispute if there isn't one. */
export function InvestigationLanding() {
  const { data, isLoading } = useQuery({
    queryKey: ['urgentDisputes'],
    queryFn: () => fetchDisputes({ sort_by: 'priority_score', sort_order: 'desc' }),
  });
  if (isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  const last = (data ?? []).find((d) => d.id === getLastCase()); // ignored if that case no longer exists
  const top = last ?? (data ?? []).find((d) => OPEN_STATUSES.includes(d.status)) ?? data?.[0];
  return <Navigate to={top ? `/investigate/${top.id}` : '/queue'} replace />;
}
