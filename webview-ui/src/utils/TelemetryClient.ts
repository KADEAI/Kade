import posthog from "posthog-js"

import type { TelemetrySetting } from "@roo-code/types"

class TelemetryClient {
	private static instance: TelemetryClient
	private static telemetryEnabled: boolean = false

	public updateTelemetryState(telemetrySetting: TelemetrySetting, apiKey?: string, distinctId?: string) {
		posthog.reset()

		if (telemetrySetting !== "disabled" && apiKey && distinctId) {
			TelemetryClient.telemetryEnabled = true

			posthog.init(apiKey, {
				api_host: "https://us.i.posthog.com", // kade_change
				ui_host: "https://us.posthog.com",
				persistence: "localStorage",
				loaded: () => posthog.identify(distinctId),
				capture_pageview: false,
				capture_pageleave: false,
				autocapture: false,
			})

			posthog.identify(distinctId) // kade_change: loaded above only works the first time
		} else {
			TelemetryClient.telemetryEnabled = false
		}
	}

	public static getInstance(): TelemetryClient {
		if (!TelemetryClient.instance) {
			TelemetryClient.instance = new TelemetryClient()
		}

		return TelemetryClient.instance
	}

	// kade_change start
	public captureException(error: Error, properties?: Record<string, any>) {
		if (TelemetryClient.telemetryEnabled) {
			try {
				posthog.captureException(error, properties)
			} catch (_error) {
				// Silently fail if there's an error capturing an event.
			}
		}
	}
	// kade_change end

	public capture(eventName: string, properties?: Record<string, any>) {
		if (TelemetryClient.telemetryEnabled) {
			try {
				posthog.capture(eventName, properties)
			} catch (_error) {
				// Silently fail if there's an error capturing an event.
			}
		}
	}
}

export const telemetryClient = TelemetryClient.getInstance()
