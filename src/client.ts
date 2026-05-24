import "dotenv/config"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { confirm, input, select } from "@inquirer/prompts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
  CreateMessageRequestSchema,
  Prompt,
  PromptMessage,
  Tool as McpTool,
} from "@modelcontextprotocol/sdk/types.js"
import { generateText, jsonSchema, ToolSet } from "ai"

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash"

function mcpToolsToAiTools(mcpTools: McpTool[]): ToolSet {
  return Object.fromEntries(
    mcpTools.map(mcpTool => [
      mcpTool.name,
      {
        description: mcpTool.description,
        inputSchema: jsonSchema(mcpTool.inputSchema),
        execute: async (args: Record<string, unknown>) => {
          const res = await mcp.callTool({
            name: mcpTool.name,
            arguments: args,
          })
          const content = res.content as Array<{ type: string; text?: string }>
          const part = content.find(c => c.type === "text")
          return part?.text ?? JSON.stringify(res)
        },
      },
    ])
  )
}

type TextContentMessage = { content: { type: "text"; text: string } }

function hasTextContent(message: {
  content: { type: string } | Array<{ type: string }>
}): message is TextContentMessage {
  return !Array.isArray(message.content) && message.content.type === "text"
}

function formatGenerateTextError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes("quota") || err.message.includes("429")) {
      return "Gemini API quota exceeded. Wait and retry, switch GEMINI_MODEL in .env, or use Tools/Resources (no LLM)."
    }
    return err.message
  }
  return String(err)
}

const mcp = new Client(
  {
    name: "text-client-video",
    version: "1.0.0",
  },
  { capabilities: { sampling: {} } }
)

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/server.js"],
  stderr: "ignore",
})

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
})

async function main() {
  await mcp.connect(transport)
  const [{ tools }, { prompts }, { resources }, { resourceTemplates }] =
    await Promise.all([
      mcp.listTools(),
      mcp.listPrompts(),
      mcp.listResources(),
      mcp.listResourceTemplates(),
    ])

  mcp.setRequestHandler(CreateMessageRequestSchema, async request => {
    const texts: string[] = []
    for (const message of request.params.messages) {
      if (!hasTextContent(message)) continue
      const text = await handleServerMessagePrompt(message)
      if (text != null) texts.push(text)
    }

    return {
      role: "user",
      model: GEMINI_MODEL,
      stopReason: "endTurn",
      content: {
        type: "text",
        text: texts.join("\n"),
      },
    }
  })

  console.log("You are connected!")
  while (true) {
    const option = await select({
      message: "What would you like to do",
      choices: ["Query", "Tools", "Resources", "Prompts"],
    })

    switch (option) {
      case "Tools":
        const toolName = await select({
          message: "Select a tool",
          choices: tools.map(tool => ({
            name: tool.annotations?.title || tool.name,
            value: tool.name,
            description: tool.description,
          })),
        })
        const tool = tools.find(t => t.name === toolName)
        if (tool == null) {
          console.error("Tool not found.")
        } else {
          await handleTool(tool)
        }
        break
      case "Resources":
        const resourceUri = await select({
          message: "Select a resource",
          choices: [
            ...resources.map(resource => ({
              name: resource.name,
              value: resource.uri,
              description: resource.description,
            })),
            ...resourceTemplates.map(template => ({
              name: template.name,
              value: template.uriTemplate,
              description: template.description,
            })),
          ],
        })
        const uri =
          resources.find(r => r.uri === resourceUri)?.uri ??
          resourceTemplates.find(r => r.uriTemplate === resourceUri)
            ?.uriTemplate
        if (uri == null) {
          console.error("Resource not found.")
        } else {
          await handleResource(uri)
        }
        break
      case "Prompts":
        const promptName = await select({
          message: "Select a prompt",
          choices: prompts.map(prompt => ({
            name: prompt.name,
            value: prompt.name,
            description: prompt.description,
          })),
        })
        const prompt = prompts.find(p => p.name === promptName)
        if (prompt == null) {
          console.error("Prompt not found.")
        } else {
          await handlePrompt(prompt)
        }
        break
      case "Query":
        await handleQuery(tools)
    }
  }
}

async function handleQuery(tools: McpTool[]) {
  const query = await input({ message: "Enter your query" })

  try {
    const { text } = await generateText({
      model: google(GEMINI_MODEL),
      prompt: query,
      tools: mcpToolsToAiTools(tools),
    })
    console.log(text || "No text generated.")
  } catch (err) {
    console.error(formatGenerateTextError(err))
  }
}

async function handleTool(tool: McpTool) {
  const args: Record<string, string> = {}
  for (const [key, value] of Object.entries(
    tool.inputSchema.properties ?? {}
  )) {
    args[key] = await input({
      message: `Enter value for ${key} (${(value as { type: string }).type}):`,
    })
  }

  const res = await mcp.callTool({
    name: tool.name,
    arguments: args,
  })

  console.log((res.content as [{ text: string }])[0].text)
}

async function handleResource(uri: string) {
  let finalUri = uri
  const paramMatches = uri.match(/{([^}]+)}/g)

  if (paramMatches != null) {
    for (const paramMatch of paramMatches) {
      const paramName = paramMatch.replace("{", "").replace("}", "")
      const paramValue = await input({
        message: `Enter value for ${paramName}:`,
      })
      finalUri = finalUri.replace(paramMatch, paramValue)
    }
  }

  const res = await mcp.readResource({
    uri: finalUri,
  })

  const content = res.contents[0]
  if (!("text" in content)) {
    console.error("Resource has no text content (blob-only).")
    return
  }

  console.log(JSON.stringify(JSON.parse(content.text), null, 2))
}

async function handlePrompt(prompt: Prompt) {
  const args: Record<string, string> = {}
  for (const arg of prompt.arguments ?? []) {
    args[arg.name] = await input({
      message: `Enter value for ${arg.name}:`,
    })
  }

  const response = await mcp.getPrompt({
    name: prompt.name,
    arguments: args,
  })

  for (const message of response.messages) {
    if (!hasTextContent(message)) {
      console.log("(Skipped non-text prompt message.)")
      continue
    }
    console.log(await handleServerMessagePrompt(message))
  }
}

async function handleServerMessagePrompt(message: TextContentMessage) {
  console.log(message.content.text)
  const run = await confirm({
    message: "Would you like to run the above prompt",
    default: true,
  })

  if (!run) return

  try {
    const { text } = await generateText({
      model: google(GEMINI_MODEL),
      prompt: message.content.text,
    })
    return text
  } catch (err) {
    console.error(formatGenerateTextError(err))
    return undefined
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})