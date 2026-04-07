const UNSUPPORTED_GEMINI_SCHEMA_FIELDS = new Set([
	"additionalProperties",
	"$schema",
	"$id",
	"$comment",
	"$ref",
	"$defs",
	"definitions",
	"const",
	"contentMediaType",
	"contentEncoding",
	"if",
	"then",
	"else",
	"not",
	"patternProperties",
	"unevaluatedProperties",
	"unevaluatedItems",
	"dependentRequired",
	"dependentSchemas",
	"propertyNames",
	"minContains",
	"maxContains",
])

type GeminiFunctionDeclaration = {
	name: string
	description: string
	parameters: Record<string, unknown>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
}

function makePlaceholderSchema(): Record<string, unknown> {
	return {
		type: "OBJECT",
		properties: {
			_placeholder: {
				type: "BOOLEAN",
				description: "Placeholder. Always pass true.",
			},
		},
		required: ["_placeholder"],
	}
}

export function toGeminiSchema(schema: unknown): Record<string, unknown> {
	if (!isObjectRecord(schema)) {
		return makePlaceholderSchema()
	}

	if (Array.isArray(schema.type)) {
		const variantTypes = schema.type.filter((type): type is string => typeof type === "string" && type !== "null")
		if (variantTypes.length === 1) {
			return toGeminiSchema({ ...schema, type: variantTypes[0] })
		}
		if (variantTypes.length > 1) {
			return {
				anyOf: variantTypes.map((variantType) => {
					const variantSchema: Record<string, unknown> = { ...schema, type: variantType }
					if (variantType !== "array") {
						delete variantSchema.items
					}
					if (variantType !== "object") {
						delete variantSchema.properties
						delete variantSchema.required
					}
					return toGeminiSchema(variantSchema)
				}),
			}
		}
	}

	const result: Record<string, unknown> = {}
	const propertyNames = new Set<string>()

	if (isObjectRecord(schema.properties)) {
		for (const propName of Object.keys(schema.properties)) {
			propertyNames.add(propName)
		}
	}

	for (const [key, value] of Object.entries(schema)) {
		if (UNSUPPORTED_GEMINI_SCHEMA_FIELDS.has(key)) {
			continue
		}

		if (key === "type" && typeof value === "string") {
			result[key] = value.toUpperCase()
			continue
		}

		if (key === "properties" && isObjectRecord(value)) {
			const properties: Record<string, unknown> = {}
			for (const [propName, propSchema] of Object.entries(value)) {
				properties[propName] = toGeminiSchema(propSchema)
			}
			result[key] = properties
			continue
		}

		if (key === "items") {
			result[key] = isObjectRecord(value) ? toGeminiSchema(value) : { type: "STRING" }
			continue
		}

		if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
			result[key] = value.map((item) => (isObjectRecord(item) ? toGeminiSchema(item) : item))
			continue
		}

		if (key === "required" && Array.isArray(value)) {
			if (propertyNames.size > 0) {
				const validRequired = value.filter((prop): prop is string => typeof prop === "string" && propertyNames.has(prop))
				if (validRequired.length > 0) {
					result[key] = validRequired
				}
			} else {
				result[key] = value
			}
			continue
		}

		result[key] = value
	}

	if (result.type === "ARRAY" && !result.items) {
		result.items = { type: "STRING" }
	}

	if (result.type === "OBJECT" && !isObjectRecord(result.properties)) {
		result.properties = {}
	}

	return result
}

function sanitizeToolName(name: unknown, fallbackIndex: number) {
	return String(name || `tool-${fallbackIndex}`)
		.replace(/[^a-zA-Z0-9_-]/g, "_")
		.slice(0, 64)
}

function getToolSchemaCandidate(tool: Record<string, unknown>, decl?: Record<string, unknown>) {
	return (
		decl?.parameters ||
		decl?.parametersJsonSchema ||
		decl?.input_schema ||
		decl?.inputSchema ||
		(tool.function as Record<string, unknown> | undefined)?.parameters ||
		(tool.function as Record<string, unknown> | undefined)?.parametersJsonSchema ||
		(tool.function as Record<string, unknown> | undefined)?.input_schema ||
		(tool.function as Record<string, unknown> | undefined)?.inputSchema ||
		(tool.custom as Record<string, unknown> | undefined)?.parameters ||
		(tool.custom as Record<string, unknown> | undefined)?.parametersJsonSchema ||
		(tool.custom as Record<string, unknown> | undefined)?.input_schema ||
		(tool.custom as Record<string, unknown> | undefined)?.inputSchema ||
		tool.parameters ||
		tool.parametersJsonSchema ||
		tool.input_schema ||
		tool.inputSchema
	)
}

export function collectGeminiNativeFunctionDeclarations(tools: any[]): GeminiFunctionDeclaration[] {
	const functionDeclarations: GeminiFunctionDeclaration[] = []

	for (const tool of tools) {
		if (!isObjectRecord(tool)) {
			continue
		}

		if (Array.isArray(tool.functionDeclarations)) {
			for (const declaration of tool.functionDeclarations) {
				if (!isObjectRecord(declaration)) {
					continue
				}

				functionDeclarations.push({
					name: sanitizeToolName(declaration.name, functionDeclarations.length),
					description: String(declaration.description || ""),
					parameters: toGeminiSchema(getToolSchemaCandidate(tool, declaration)),
				})
			}
			continue
		}

		const fn = isObjectRecord(tool.function) ? tool.function : undefined
		const custom = isObjectRecord(tool.custom) ? tool.custom : undefined

		functionDeclarations.push({
			name: sanitizeToolName(tool.name || fn?.name || custom?.name, functionDeclarations.length),
			description: String(tool.description || fn?.description || custom?.description || ""),
			parameters: toGeminiSchema(getToolSchemaCandidate(tool)),
		})
	}

	return functionDeclarations
}
