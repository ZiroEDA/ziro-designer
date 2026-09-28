// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/view/zoom_controller.h` + `common/view/zoom_controller.cpp`:
 * `KIGFX::ZOOM_CONTROLLER` and the two controllers that turn a wheel rotation
 * into a scale factor.
 */

/**
 * Handle the response of the zoom scale to external inputs.
 */
export abstract class ZOOM_CONTROLLER {
  /**
   * Gets the scale factor produced by a given mousewheel rotation.
   *
   * @param aRotation rotation of the mouse wheel (this comes from
   *                  wxMouseEvent::GetWheelRotation()).
   * @return the scale factor to scroll by.
   */
  abstract GetScaleForRotation(aRotation: number): number;
}

/** `ACCELERATING_ZOOM_CONTROLLER::TIMESTAMP_PROVIDER`: a `steady_clock` in ms. */
export interface TIMESTAMP_PROVIDER {
  /** @return the timestamp at the current time. */
  GetTimestamp(): number;
}

/** `SIMPLE_TIMESTAMPER`: `CLOCK::now()`. */
class SIMPLE_TIMESTAMPER implements TIMESTAMP_PROVIDER {
  GetTimestamp(): number {
    return performance.now();
  }
}

/**
 * A `ZOOM_CONTROLLER` that adds acceleration based on the time between inputs.
 */
export class ACCELERATING_ZOOM_CONTROLLER extends ZOOM_CONTROLLER {
  /// The default timeout, after which a another scroll will not be accelerated.
  static readonly DEFAULT_TIMEOUT = 500;

  /// The default minimum step factor for accelerating controller.
  static readonly DEFAULT_ACCELERATION_SCALE = 5.0;

  /// The timestamp provider to use (might be provided externally).
  private m_timestampProv: TIMESTAMP_PROVIDER;

  /// Any provider owned by this class (the default one, if used).
  private m_ownTimestampProv: TIMESTAMP_PROVIDER | null = null;

  /// The timestamp of the previous event.
  private m_prevTimestamp: number;

  /// The timeout value.
  private m_accTimeout: number;

  /// Previous rotation was positive.
  private m_prevRotationPositive = false;

  /// A multiplier for the minimum zoom step size
  private m_scale: number;

  /**
   * @param aScale a scaling parameter that adjusts the magnitude of the result
   *               produced by the zoom controller.
   * @param aAccTimeout the timeout - if a scroll happens within this timeframe,
   *                    the zoom will be accelerated.
   * @param aTimestampProv a provider for timestamps. If null, a default will be
   *                       provided, which is the normal case.
   */
  constructor(
    aScale: number = ACCELERATING_ZOOM_CONTROLLER.DEFAULT_ACCELERATION_SCALE,
    aAccTimeout: number = ACCELERATING_ZOOM_CONTROLLER.DEFAULT_TIMEOUT,
    aTimestampProv: TIMESTAMP_PROVIDER | null = null,
  ) {
    super();
    this.m_accTimeout = aAccTimeout;
    this.m_scale = aScale;

    if (aTimestampProv) {
      this.m_timestampProv = aTimestampProv;
    } else {
      this.m_ownTimestampProv = new SIMPLE_TIMESTAMPER();
      this.m_timestampProv = this.m_ownTimestampProv;
    }

    this.m_prevTimestamp = this.m_timestampProv.GetTimestamp();
  }

  override GetScaleForRotation(aRotation: number): number {
    // The minimal step value when changing the current zoom level
    const minStep = 1.05;

    const timestamp = this.m_timestampProv.GetTimestamp();
    // duration_cast<milliseconds> truncates
    const timeDiff = Math.trunc(timestamp - this.m_prevTimestamp);

    this.m_prevTimestamp = timestamp;

    let zoomScale: number;

    // Set scaling speed depending on scroll wheel event interval
    if (timeDiff < this.m_accTimeout && aRotation > 0 === this.m_prevRotationPositive) {
      // timeDiff / m_accTimeout divides two std::chrono::milliseconds: an integer quotient
      zoomScale = (2.05 * this.m_scale) / 5.0 - Math.trunc(timeDiff / this.m_accTimeout);

      // be sure zoomScale value is significant
      zoomScale = Math.max(zoomScale, minStep);

      if (aRotation < 0) zoomScale = 1.0 / zoomScale;
    } else {
      zoomScale = aRotation > 0 ? minStep : 1 / minStep;
    }

    this.m_prevRotationPositive = aRotation > 0;

    return zoomScale;
  }

  GetTimeout(): number {
    return this.m_accTimeout;
  }

  SetTimeout(aNewTimeout: number): void {
    this.m_accTimeout = aNewTimeout;
  }
}

/**
 * A #ZOOM_CONTROLLER that zooms by a fixed factor based only on the magnitude
 * of the scroll wheel rotation.
 */
export class CONSTANT_ZOOM_CONTROLLER extends ZOOM_CONTROLLER {
  /// A suitable (magic) scale factor for GTK3 systems.
  static readonly GTK3_SCALE = 0.002;

  /// A suitable (magic) scale factor for Mac systems.
  static readonly MAC_SCALE = 0.01;

  /// A suitable (magic) scale factor for Windows systems.
  static readonly MSW_SCALE = 0.005;

  /// Multiplier for manual scale ssetting.
  static readonly MANUAL_SCALE_FACTOR = 0.001;

  /// The scale factor set by the constructor.
  private m_scale: number;

  /**
   * @param aScale the constant scaling factor.
   */
  constructor(aScale: number) {
    super();
    this.m_scale = aScale;
  }

  override GetScaleForRotation(aRotation: number): number {
    aRotation = aRotation > 0 ? Math.min(aRotation, 100) : Math.max(aRotation, -100);

    const dscale = aRotation * this.m_scale;

    const zoom_scale = aRotation > 0 ? 1 + dscale : 1 / (1 - dscale);

    return zoom_scale;
  }
}
