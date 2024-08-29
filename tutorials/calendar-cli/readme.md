# Building an AI Agent for Google Calendar

This project demonstrates how to build an AI agent that integrates with Google Calendar to help users manage their calendar events. The AI agent can assist users by creating, fetching, and managing calendar events, and can also utilize web search capabilities when necessary.

## Features

- **Google Calendar Integration**: The AI agent can authorize and access the user's Google Calendar to create events, fetch events within a specific date range, and manage calendar data.
- **Web Search Capability**: The agent can perform web searches using DuckDuckGo when it does not have sufficient information to answer a query.
- **Natural Language Interaction**: Users interact with the AI agent via a terminal interface, inputting questions and commands in natural language.


## Usage

**Interacting with the AI Agent:**

- The AI agent will prompt you for input in the terminal.
- You can ask the agent to create a calendar event, fetch events, or perform a web search.
- The agent will automatically handle Google Calendar authentication when necessary.

## Project Structure

- `main.js`: The main entry point of the application.
- `credentials.json`: Google API credentials file.
- `token.json`: Stores the user's Google authentication token (generated after the first successful authentication).


## Dependencies

- **Google Calendar API**: For managing calendar events.
- **Duck-Duck-Scrape**: For performing web searches.
- **Chalk**: For colored terminal output.
- **Date-fns**: For date formatting and manipulation.

### Related Blog Posts

-   [Building an AI Agent for Google Calendar - Part 1/2](https://friendli.ai/blog/ai-agent-google-calendar) - FriendliAI blog
