import path from 'path';
import fs from 'fs/promises';
import process from 'process';
import * as readline from 'node:readline/promises';

// vercel ai sdk dependencies
import { z } from 'zod';
import { streamText } from 'ai';
import { friendli } from '@friendliai/ai-provider';

// for calendar features
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';

// for web search tool
import { search } from 'duck-duck-scrape';

// utility dependencies
import chalk from 'chalk';
import { format } from 'date-fns';

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// for google account authentication
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

let calendar;
let isAuthorized = false;

const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

while (1) {
  const input = await terminal.question('You: ');

  const result = await streamText({
    model: friendli('meta-llama-3.1-70b-instruct'),
    temperature: 0.2,
    frequencyPenalty: 0.5,
    maxSteps: 4,
    prompt: input,
    system: `You are an assistant that can help users with various tasks, Today is ${today}.`,
    tools: {
      ...(isAuthorized
        ? {
            fetchCalendarEvents: {
              description: 'Retrieves calendar events within a specified date range.',
              parameters: z.object({
                startDate: z
                  .string()
                  .describe('Start date of the search range (format: yyyy-MM-dd)'),
                endDate: z.string().describe('End date of the search range (format: yyyy-MM-dd)'),
              }),
              execute: async ({ startDate, endDate }) => {
                const payload = {
                  calendarId: 'primary',
                  summary: 'Calendar Events',
                  timeMin: new Date(`${startDate} 00:00`).toISOString(),
                  timeMax: new Date(`${endDate} 23:59`).toISOString(),
                  singleEvents: true,
                  orderBy: 'startTime',
                };

                try {
                  const calendarRes = await calendar.events.list(payload);
                  const events = calendarRes.data.items
                    ?.map((item) => {
                      const { summary, start, end } = item;

                      if (start.dateTime && end.dateTime) {
                        return {
                          summary,
                          start,
                          end,
                          allDay: false,
                        };
                      } else {
                        const startDate = new Date(start.date);
                        const endDate = new Date(end.date);
                        endDate.setSeconds(endDate.getSeconds() - 1);

                        return {
                          summary,
                          start: format(startDate, 'yyyy-MM-dd'),
                          end: format(endDate, 'yyyy-MM-dd'),
                          allDay: true,
                        };
                      }
                    })
                    .filter((event) => event !== null);
                  return JSON.stringify(events);
                } catch (error) {
                  return JSON.stringify({
                    message:
                      'Error fetching calendar events. Maybe you need to authorize the assistant to access your calendar.',
                  });
                }
              },
            },
            createCalendarEvent: {
              description: 'Creates a new calendar event.',
              parameters: z.object({
                summary: z.string().default('New Event').describe('Title of the event to be added'),
                startTime: z
                  .string()
                  .default(format(new Date(), 'yyyy-MM-dd HH:mm'))
                  .describe("Date and time of the event, format should be 'yyyy-MM-dd HH:mm'"),
                endTime: z
                  .string()
                  .default(format(new Date(), 'yyyy-MM-dd HH:mm'))
                  .describe("Date and time of the event, format should be 'yyyy-MM-dd HH:mm'"),
              }),
              execute: async ({ summary, startTime, endTime }) => {
                const payload = {
                  calendarId: 'primary',
                  requestBody: {
                    summary,
                    start: {
                      dateTime: new Date(startTime).toISOString(),
                    },
                    end: { dateTime: new Date(endTime).toISOString() },
                  },
                };

                try {
                  const calendarRes = await calendar.events.insert(payload);
                  return JSON.stringify(calendarRes.data);
                } catch (error) {
                  return JSON.stringify({
                    message:
                      'Error creating calendar event, Maybe you need to authorize the assistant to access your calendar.',
                  });
                }
              },
            },
          }
        : {
            authorizeCalendarAccess: {
              description:
                'It must be called first before accessing any tools that allow you to control your personal calendar.',
              parameters: z.object({}),
              execute: async () => {
                isAuthorized = true;
                const auth = await authorize();
                calendar = google.calendar({
                  version: 'v3',
                  auth,
                });

                return 'Successfully authorized access to your calendar.';
              },
            },
          }),
      webSearch: {
        description: 'This tool is designed for searching DuckDuckGo for the desired query.',
        parameters: z.object({
          query: z.string().describe('The query to search for.'),
        }),
        execute: async ({ query }) => {
          try {
            const truncatedQuery = query.length > 500 ? query.substring(0, 500) : query;
            const searchResult = await search(truncatedQuery);
            return JSON.stringify({
              message: `Here are the search results for "${query}".`,
              data: searchResult.noResults
                ? `No results found for "${query}".`
                : searchResult.results,
            });
          } catch {
            return 'Search tool is not available at the moment.';
          }
        },
      },
    },
  });

  await printResult(result);
}

async function printResult(result) {
  let stepCount = 0;
  const textBuffer = [];

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta': {
        if (textBuffer.length <= 0) {
          process.stdout.write(chalk.green('AI: '));
        }
        textBuffer.push(part.textDelta);
        process.stdout.write(chalk.green(part.textDelta));
        break;
      }

      case 'step-finish': {
        textBuffer.length = 0;
        stepCount++;
        console.log(chalk.blue(`\n===== STEP END: ${stepCount} =====\n`));
        break;
      }

      case 'tool-call': {
        console.log(chalk.yellow(`\n${formatToolCallAndResult(part)}`));
        break;
      }
      case 'tool-result': {
        console.log(chalk.yellow(`\n${formatToolCallAndResult(part)}`));
        break;
      }

      case 'error': {
        console.error(
          chalk.red('Error: After using a Google Calendar tool, the token may be invalid.')
        );
        break;
      }
    }
  }
}

function formatToolCallAndResult(toolCall) {
  const formattedArgs =
    toolCall.args && Object.keys(toolCall.args).length > 0
      ? `Arguments:\n${Object.entries(toolCall.args)
          .map(([key, value]) => `  ${key}: ${value}`)
          .join('\n')}`
      : 'No arguments';

  const idPart = `ID: ${toolCall.toolCallId}\n`;
  const callPart = idPart + `Name: ${toolCall.toolName}\n${formattedArgs}`;
  const resultPart =
    toolCall.result &&
    idPart +
      `Result: ${
        JSON.stringify(toolCall.result).length > 50
          ? JSON.stringify(toolCall.result).substring(0, 50) + '...'
          : JSON.stringify(toolCall.result)
      }`;

  return resultPart ? resultPart : callPart;
}

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH, 'utf-8');
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH, 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  const payload = JSON.stringify({
    type: 'authorized_user',
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

  if (client?.credentials) {
    await saveCredentials(client);
  }

  return client;
}
