// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Right-clicking the project row in the project manager's tree.
 *
 * Reported: every file row offers "Download...", the project row offered nothing - it had no
 * right-click handler at all, though upstream's tree root has a popup like every other row
 * (PROJECT_TREE_PANE::onRight). Its own row is the whole project as a .zip.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectTreePane } from '@ziroeda/designer/src/home/project_tree_pane.js';

afterEach(cleanup);

function pane(on: { onDownloadProject?: () => void; onDownloadPath?: (p: string) => void }) {
  return render(
    <ProjectTreePane
      picked={[{ name: 'proj/proj.kicad_pro', text: '{}' }]}
      dirRoot={null}
      rootLabel="proj.kicad_pro"
      projectNames={new Set(['proj'])}
      width={250}
      expanded={new Set()}
      onToggleDir={() => {}}
      selected={new Set()}
      onSelect={() => {}}
      rootOpen
      onToggleRoot={() => {}}
      {...on}
    />,
  );
}

describe('the project row', () => {
  it('opens a menu on right-click whose Download Project... downloads the whole project', () => {
    const onDownloadProject = vi.fn();
    const onDownloadPath = vi.fn();
    pane({ onDownloadProject, onDownloadPath });

    fireEvent.contextMenu(screen.getByText('proj.kicad_pro'));
    fireEvent.click(screen.getByText('Download Project...'));

    expect(onDownloadProject).toHaveBeenCalledTimes(1);
    // not the .kicad_pro on its own
    expect(onDownloadPath).not.toHaveBeenCalled();
    expect(screen.queryByText('Download...')).toBeNull();
  });

  it('draws no Download Project... row where the host gives it nothing to run', () => {
    pane({});
    fireEvent.contextMenu(screen.getByText('proj.kicad_pro'));
    expect(screen.queryByText('Download Project...')).toBeNull();
  });
});
