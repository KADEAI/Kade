const DEFAULT_AIHUBMIX_ORIGIN = "https://aihubmix.com"

function stripAihubmixPathSuffix(pathname: string): string {
	return pathname
		.replace(/\/+$/, "")
		.replace(/\/api\/v1\/chat\/completions$/, "")
		.replace(/\/v1\/chat\/completions$/, "")
		.replace(/\/chat\/completions$/, "")
		.replace(/\/api\/v1$/, "")
		.replace(/\/v1$/, "")
}

function getAihubmixRootUrl(baseUrl?: string): URL {
	const rawBaseUrl = baseUrl?.trim() || DEFAULT_AIHUBMIX_ORIGIN
	const normalizedInput = /^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : `${DEFAULT_AIHUBMIX_ORIGIN}${rawBaseUrl}`
	const url = new URL(normalizedInput)
	const strippedPath = stripAihubmixPathSuffix(url.pathname)

	url.pathname = strippedPath || "/"
	url.search = ""
	url.hash = ""

	return url
}

export function getAihubmixInferenceBaseUrl(baseUrl?: string): string {
	const url = getAihubmixRootUrl(baseUrl)
	url.pathname = `${url.pathname.replace(/\/$/, "")}/v1` || "/v1"
	return url.toString().replace(/\/$/, "")
}

export function getAihubmixModelsUrl(baseUrl?: string): string {
	const url = getAihubmixRootUrl(baseUrl)
	url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v1/models` || "/api/v1/models"
	return url.toString().replace(/\/$/, "")
}
