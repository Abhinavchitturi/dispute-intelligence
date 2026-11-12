import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EvidenceRow } from '../components/EvidenceChecklist';
import { ClaimPoints } from '../components/ClaimPoints';

const line: any = { evidence_type: 'BUYER_CAMERA_FOOTAGE', label: 'Camera footage', party: 'BUYER', status: 'PROVIDED', detail: '', why: '', description: 'Porch camera video, 2026-10-26.', evidence_id: 'E1',
  provided_at: null, file_name: null, content_type: null, size_bytes: null, duration_seconds: null, storage: null, preview: null, is_video: false };

describe('Evidence that is on file but doubtful', () => {
  it('is yellow and says why, not green', () => {
    render(<ul><EvidenceRow line={{ ...line, concern: 'The footage is from Oct 26, but the carrier delivered on Oct 31, so it does not cover the delivery.' }} /></ul>);
    expect(screen.getByText('Received, doubtful')).toHaveClass('text-amber-400');
    expect(screen.getByText(/The footage is from Oct 26/)).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveClass('border-amber-400/40');
  });

  it('is plain green when nothing is wrong with it', () => {
    render(<ul><EvidenceRow line={line} /></ul>);
    expect(screen.getByText('Received')).toHaveClass('text-emerald-400');
  });

  it('turns the buyer\'s claim chip yellow', () => {
    render(<ClaimPoints points={[{ key: 'footage', label: 'Camera footage', quote: 'My camera shows nothing.', note: 'n', on_file: true, evidence_type: 'BUYER_CAMERA_FOOTAGE', party: 'BUYER', concern: 'From the wrong day.' }]} />);
    expect(screen.getByRole('button', { name: /Camera footage/ })).toHaveClass('text-amber-300');
  });
});
