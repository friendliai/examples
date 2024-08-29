import path from "path";
import fs from "fs/promises";
import process from "process";
import * as readline from "node:readline/promises";

// vercel ai sdk dependencies
import { z } from "zod";
import { generateText, tool } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

// for calednar features
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";

// for web search tool
import { search } from "duck-duck-scrape";

// utility dependencies
import chalk from "chalk";
import { format } from "date-fns";

const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const friendliai = createOpenAI({
    apiKey: process.env.FRIENDLI_API_KEY,
    baseURL: "https://inference.friendli.ai/v1",
});

// for google account authentication
const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const TOKEN_PATH = path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

let calendar;
let isAuthorized = false;

while (1) {
    const input = await terminal.question("You: ");

    const { roundtrips } = await generateText({
        temperature: 0.2,
        frequencyPenalty: 0.5,
        maxToolRoundtrips: 4,
        prompt: input,

        model: friendliai("meta-llama-3.1-8b-instruct"),

        system:
            `You are an assistant that can help users with various tasks.\n
      You can use tools to assist users if needed, but using a tool is not neccessary.\n
      Please answer the user’s questions based on what you know.\n
      If you know the answer based on your knowledge, please do not use the 'webSearch' tool.\n
      Use the 'webSearch' tool only when you do not have accurate information to answer the question.\n
      When you use the 'webSearch' tool, do not inform users that you have used it.\n
      If the user requests help with users' calendar, you should assist them.\n
      If the user cancels, do not try again.\n` +
            `To assist with their calendar, please remember that today's date is ${new Date().toLocaleDateString(
                "en-US",
                {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                }
            )}.\n` +
            `Use 'createCalendarEvent' tool and 'fetchCalendarEvents' tool only when you assist with user's calendar
      Make sure that when using tools, only use one tool per turn.` +
            `createCalendarEvent and fetchCalendarEvents tools require authorization to access the user's calendar.
      CURRENT AUTHORIZATION STATUS: ${
          isAuthorized
              ? "Authorized"
              : "Unauthorized, Authentication is required prior to calling the calendar or schedule."
      }
      IF AUTHORIZATION IS NEEDED, PLEASE USE 'authorizeCalendarAccess' TOOL TO AUTHORIZE THE ASSISTANT TO ACCESS THE USER'S CALENDAR.
      `,

        tools: {
            webSearch: tool({
                description: `This tool is designed for searching DuckDuckGo for the desired query.\n`,
                parameters: z.object({
                    query: z.string().describe("The query to search for."),
                }),
                execute: async ({ query }) => {
                    const searchResult = await search(query).then((res) => {
                        return res;
                    });

                    if (searchResult.noResults) {
                        return {
                            message: `No results found for "${query}".`,
                        };
                    }

                    const result = {
                        message: `Here are the search results for "${query}"`,
                        data: searchResult.results.map((result) => ({
                            title: result.title,
                            url: result.url,
                            description: result.description.replace(
                                /<\/?[^>]+(>|$)/g,
                                ""
                            ),
                        })),
                    };
                    return JSON.stringify(result);
                },
            }),
            authorizeCalendarAccess: tool({
                description: `Grants the assistant access to the user's calendar.
          - Allows the assistant to view and manage calendar events.
          - Access expires at the end of the current session.
          - Used only when necessary to protect user privacy.`,
                parameters: z.object({}),
                execute: async () => {
                    isAuthorized = true;

                    const auth = await authorize();
                    calendar = google.calendar({ version: "v3", auth });

                    return "Successfully authorized access to your calendar.";
                },
            }),
            fetchCalendarEvents: tool({
                description: `Retrieves calendar events within a specified date range.
          - Searches for all events between the start and end dates.
          - Displays the title, date, and time of each event.
          - Requires prior calendar access authorization.`,
                parameters: z.object({
                    startDate: z
                        .string()
                        .describe(
                            "Start date of the search range (format: yyyy-MM-dd)"
                        ),
                    endDate: z
                        .string()
                        .describe(
                            "End date of the search range (format: yyyy-MM-dd)"
                        ),
                }),
                execute: async ({ startDate, endDate }) => {
                    const payload = {
                        calendarId: "primary",
                        summary: "Calendar Events",
                        timeMin: new Date(`${startDate} 00:00`).toISOString(),
                        timeMax: new Date(`${endDate} 23:59`).toISOString(),
                        singleEvents: true,
                        orderBy: "startTime",
                    };

                    try {
                        const calendarRes = await calendar.events.list(payload);

                        const events = calendarRes.data.items
                            ?.map((item) => {
                                const { summary, start, end } = item;

                                if (start.dateTime && end.dateTime) {
                                    return {
                                        summary,
                                        start: start,
                                        end: end,
                                        allDay: false,
                                    };
                                } else {
                                    const startDate = new Date(start.date);
                                    const endDate = new Date(end.date);
                                    endDate.setSeconds(
                                        endDate.getSeconds() - 1
                                    );

                                    return {
                                        summary,
                                        start: format(startDate, "yyyy-MM-dd"),
                                        end: format(endDate, "yyyy-MM-dd"),
                                        allDay: true,
                                    };
                                }
                            })
                            .filter((event) => event !== null);
                        return JSON.stringify(events);
                    } catch (error) {
                        return JSON.stringify({
                            message:
                                "Error fetching calendar events. Maybe you need to authorize the assistant to access your calendar.",
                        });
                    }
                },
            }),
            createCalendarEvent: tool({
                description: `Creates a new calendar event.
          - Adds a new event on the specified date and time.
          - Allows input of event title and optional description.
          - Requires prior calendar access authorization.`,
                parameters: z.object({
                    summary: z
                        .string()
                        .default("New Event")
                        .describe("Title of the event to be added"),
                    startTime: z
                        .string()
                        .default(format(new Date(), "yyyy-MM-dd HH:mm"))
                        .describe(
                            "Date and time of the event, format should be 'yyyy-MM-dd HH:mm'"
                        ),
                    endTime: z
                        .string()
                        .default(format(new Date(), "yyyy-MM-dd HH:mm"))
                        .describe(
                            "Date and time of the event, format should be 'yyyy-MM-dd HH:mm'"
                        ),
                }),
                execute: async ({ summary, startTime, endTime }) => {
                    const payload = {
                        calendarId: "primary",
                        requestBody: {
                            summary: summary,
                            start: {
                                dateTime: new Date(startTime).toISOString(),
                            },
                            end: {
                                dateTime: new Date(endTime).toISOString(),
                            },
                        },
                    };

                    try {
                        const calendarRes = await calendar.events.insert(
                            payload
                        );
                        return JSON.stringify(calendarRes.data);
                    } catch (error) {
                        return JSON.stringify({
                            message:
                                "Error creating calendar event, Maybe you need to authorize the assistant to access your calendar.",
                        });
                    }
                },
            }),
        },
    });

    PrintRoundtrip(roundtrips);
}

// Helper function to print the roundtrips
function PrintRoundtrip(roundtrips) {
    roundtrips.forEach((roundtrip, idx) => {
        console.log(chalk.bold.blue(`\n===== ROUNDTRIP: ${idx + 1} =====`));

        if (roundtrip.toolCalls && roundtrip.toolCalls.length > 0) {
            console.log(chalk.yellow("\nTool Calls:"));
            roundtrip.toolCalls.forEach((toolCall, toolIdx) => {
                const matchingResult = roundtrip.toolResults.find(
                    (result) => result.toolCallId === toolCall.toolCallId
                );

                console.log(
                    chalk.yellow(
                        `  ${toolIdx + 1}. ${formatToolCallAndResult(
                            toolCall,
                            matchingResult
                        )}`
                    )
                );
            });
        } else {
            console.log(chalk.yellow("\nNo Tool Calls"));
        }

        if (roundtrip.text) {
            console.log(chalk.magenta(`\nAI Response: ${roundtrip.text}`));
        } else {
            console.log(chalk.magenta("\nNo AI Response"));
        }
    });
}

function formatToolCallAndResult(toolCall, toolResult) {
    return ` ID: ${toolCall.toolCallId}
      Name: ${toolCall.toolName}
      ${
          toolCall.args && Object.keys(toolCall.args).length > 0
              ? `Arguments:
        ${Object.entries(toolCall.args)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n        ")}`
              : "No arguments"
      }
      ${
          toolResult
              ? `Result: ${
                    JSON.stringify(toolResult.result).length > 50
                        ? JSON.stringify(toolResult.result).substring(0, 50) +
                          "..."
                        : JSON.stringify(toolResult.result)
                }`
              : "No corresponding result"
      }`;
}

async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: "authorized_user",
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}
