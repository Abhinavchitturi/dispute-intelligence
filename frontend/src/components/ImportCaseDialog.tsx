import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importPayPalCase } from '../api/client';
import { Button, Field, Input, Modal, useToast } from './ui/kit';

/** Pulls one PayPal case in by the ID the buyer was shown, without waiting for PayPal's dispute list to catch up. */
export function ImportCaseDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported?: (id: string) => void }) {
  const [caseId, setCaseId] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = caseId.trim().toUpperCase();
  const valid = /^PP-[A-Z0-9-]{4,60}$/.test(id);

  const run = useMutation({
    mutationFn: () => importPayPalCase(id),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['disputes'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] }),
      ]);
      toast('success', result.message);
      setCaseId('');
      onClose();
      onImported?.(result.dispute_id);
    },
    onError: (e) => toast('error', e instanceof Error ? e.message : 'Could not import the case.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (valid && !run.isPending) run.mutate();
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Import a PayPal case"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="import-case" loading={run.isPending} disabled={!valid}>Import</Button>
      </>}
    >
      <form id="import-case" onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-300">
          The buyer is shown a case ID as soon as they report a problem on PayPal. New cases come in by themselves,
          but PayPal can take a while to list them. Enter the ID to bring one in now.
        </p>
        <Field label="PayPal case ID">
          <Input autoFocus value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="PP-R-ABC-12345678" aria-label="PayPal case ID" />
        </Field>
      </form>
    </Modal>
  );
}
