// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ZONE_PREVIEW_NOTEBOOK` and `ZONE_PREVIEW_NOTEBOOK_PAGE` -
 * `pcbnew/zone_manager/zone_preview_notebook.{h,cpp}`: one page per layer of the
 * selected zone, each a {@link ZONE_PREVIEW_CANVAS}, the layer's name and colour
 * swatch on its tab.
 *
 * The `wxNotebook` (tab strip, page windows, the image list of 128 layer
 * swatches, `PostSizeEvent`) is the dialog's; this class holds the parts that
 * are logic: which pages exist for a zone, which one is selected after a
 * change, and the zoom carried from the old current page to the new ones.
 * A page's canvas is made by the host (`ZONE_PREVIEW_NOTEBOOK_HOST.CreateCanvas`),
 * which owns the window it draws into.
 */
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { BOARD } from '../board.js';
import type { ZONE } from '../zone.js';

export const LAYER_ICON_SIZE = { WIDTH: 16, HEIGHT: 16 } as const;

/** What a page asks of its canvas (ZONE_PREVIEW_CANVAS). */
export interface ZONE_PREVIEW_CANVAS_LIKE {
  GetView(): { GetScale(): number; GetCenter(): Vec2 };
  LockZoom(aScale: number, aCenter: Vec2): void;
  ZoomFitScreen(): void;
}

/** `ZONE_PREVIEW_NOTEBOOK_PAGE`. */
export class ZONE_PREVIEW_NOTEBOOK_PAGE {
  private m_layer: number;
  private m_canvas: ZONE_PREVIEW_CANVAS_LIKE;

  constructor(aLayer: PCB_LAYER_ID, aCanvas: ZONE_PREVIEW_CANVAS_LIKE) {
    this.m_layer = aLayer;
    this.m_canvas = aCanvas;
  }

  GetLayer(): number {
    return this.m_layer;
  }

  GetCanvas(): ZONE_PREVIEW_CANVAS_LIKE {
    return this.m_canvas;
  }
}

/** What the notebook reads from its `PCB_BASE_FRAME` and the window it lives in. */
export interface ZONE_PREVIEW_NOTEBOOK_HOST {
  GetBoard(): BOARD | null;
  /**
   * `new ZONE_PREVIEW_CANVAS( aBoard, aZone->Clone( aLayer ), aLayer, page,
   * frame->GetGalDisplayOptions(), frame->GetCanvas()->GetBackend() )`.
   */
  CreateCanvas(aBoard: BOARD, aZone: ZONE, aLayer: PCB_LAYER_ID): ZONE_PREVIEW_CANVAS_LIKE;
  /** `AddPage( page, layerName, false, layer )` / `DeleteAllPages`, for the tab strip. */
  OnPagesChanged?(aPages: readonly ZONE_PREVIEW_NOTEBOOK_PAGE[], aSelection: number): void;
  /** `PostSizeEvent()`: reinit canvas size parameters and display. */
  PostSizeEvent?(): void;
}

export class ZONE_PREVIEW_NOTEBOOK {
  private m_pages: ZONE_PREVIEW_NOTEBOOK_PAGE[] = [];
  private m_selection = -1;
  private m_hasSavedZoom = false;
  private m_savedScale = 1.0;
  private m_savedCenter: Vec2 = { x: 0, y: 0 };

  constructor(private readonly m_host: ZONE_PREVIEW_NOTEBOOK_HOST) {}

  GetPageCount(): number {
    return this.m_pages.length;
  }

  GetPage(aIndex: number): ZONE_PREVIEW_NOTEBOOK_PAGE {
    return this.m_pages[aIndex]!;
  }

  /** `wxNotebook::GetSelection`: -1 with no pages. */
  GetSelection(): number {
    return this.m_selection;
  }

  /** `SetSelection`, the tab strip's own click. */
  SetSelection(aIndex: number): void {
    this.m_selection = aIndex;
    this.m_host.PostSizeEvent?.();
  }

  OnZoneSelectionChanged(aZone: ZONE | null): void {
    let preferredLayer: number = PCB_LAYER_ID.UNDEFINED_LAYER;

    if (this.m_selection >= 0 && this.m_selection < this.m_pages.length) {
      const curPage = this.m_pages[this.m_selection]!;
      preferredLayer = curPage.GetLayer();

      const view = curPage.GetCanvas().GetView();

      if (view) {
        this.m_savedScale = view.GetScale();
        this.m_savedCenter = view.GetCenter();
        this.m_hasSavedZoom = true;
      }
    }

    // Detaching a page destroys the native window under its GAL canvas but leaves the canvas
    // repainting into it, so the pages have to be destroyed outright
    this.m_pages = [];
    this.m_selection = -1;

    if (!aZone) {
      this.m_host.OnPagesChanged?.(this.m_pages, this.m_selection);
      return;
    }

    let preferredPage: ZONE_PREVIEW_NOTEBOOK_PAGE | null = null;
    const board = this.m_host.GetBoard()!;

    for (const layer of aZone.GetLayerSet().UIOrder()) {
      const page = new ZONE_PREVIEW_NOTEBOOK_PAGE(
        layer,
        this.m_host.CreateCanvas(board, aZone, layer),
      );
      this.m_pages.push(page);

      if (this.m_hasSavedZoom) page.GetCanvas().LockZoom(this.m_savedScale, this.m_savedCenter);
      else page.GetCanvas().ZoomFitScreen();

      if (layer === preferredLayer) preferredPage = page;
    }

    // A zone on a rescue layer has no UI order, so it yields no pages and nothing to select
    if (this.m_pages.length === 0) {
      this.m_host.OnPagesChanged?.(this.m_pages, this.m_selection);
      return;
    }

    if (!preferredPage) preferredPage = this.m_pages[0]!;

    this.m_selection = this.m_pages.indexOf(preferredPage);
    this.m_host.OnPagesChanged?.(this.m_pages, this.m_selection);

    // Reinit canvas size parameters and display
    this.m_host.PostSizeEvent?.();
  }

  /** `OnPageChanged`: `PostSizeEvent()`. */
  OnPageChanged(): void {
    this.m_host.PostSizeEvent?.();
  }

  FitCanvasToScreen(): void {
    for (const page of this.m_pages) page.GetCanvas().ZoomFitScreen();
  }
}
