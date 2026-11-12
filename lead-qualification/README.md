# Lead Qualification + AI Calling + Appointment Scheduling

A simple automated workflow: a new lead lands in Airtable, an AI voice agent (Vapi) calls them, qualifies them and books a discovery call, then the result is written back to Airtable and the right follow-up goes out (email to the lead, Slack alert to sales).

It implements the flow from the hand-drawn diagram:

| Diagram step | Implemented as |
|---|---|
| Airtable (Watch Records) | `Airtable Trigger (Watch New Leads)` in workflow 1 |
| Vapi (Create an outbound call) | `Vapi: Create Outbound Call` (HTTP to `POST /call`) |
| Tools (Steps) → HTTP (Make a request) | `book_appointment` tool in `vapi/assistant.json` → `Webhook: Book Appointment` in workflow 2 |
| Router | `Router: Call Outcome` (Switch) |
| Airtable (Update a record) – Interested / Not Interested / Callback | `Airtable: Mark …` nodes |
| Gmail (Send an email) | `Gmail: Send Follow-Up` |
| Text Parser (Match Pattern) | `Text Parser (Match Pattern)` Code node |
| Slack (Create message) | `Slack: Notify Sales` |

## Files

```
lead-qualification/
├── n8n/
│   ├── 1-intake-and-outbound-call.json   # Airtable new lead → Vapi outbound call
│   └── 2-call-events-and-booking.json    # Vapi end-of-call routing + appointment booking tool
├── vapi/
│   └── assistant.json                    # The calling agent: prompt, booking tool, outcome schema
└── scripts/
    └── validate.mjs                      # Offline checks (node lead-qualification/scripts/validate.mjs)
```

## How it works

1. **Lead created** in Airtable (Status `New`, with a phone number in E.164 format, e.g. `+15551234567`).
2. **Workflow 1** places the call through Vapi and stores the Vapi call ID on the lead (Status `Calling`).
3. **The agent** asks qualifying questions (need, decision-maker, timeline). If the lead fits and agrees, it asks for a day and time and calls `book_appointment`.
4. **`book_appointment`** hits workflow 2, which creates a 30-minute Google Calendar event, marks the lead `Booked` with the appointment time, and returns a confirmation the agent reads back to the lead.
5. **When the call ends**, Vapi sends an `end-of-call-report` with a structured `outcome` (`interested`, `not_interested`, `callback`, `no_answer`). The Text Parser maps it, the Router sends it down the matching branch, and Airtable is updated.
   - **Interested:** Airtable → confirmation email to the lead → Slack alert to `#sales-leads`.
   - **Not interested:** Airtable only.
   - **Callback / no answer:** Airtable only, so a person can retry.

## Airtable setup

Create a base with a table named `Leads`:

| Field | Type | Notes |
|---|---|---|
| Name | Single line text | |
| Phone | Phone number | E.164 format (`+1…`) |
| Email | Email | Used for the follow-up email |
| Company | Single line text | Passed to the agent |
| Status | Single select | `New`, `Calling`, `Booked`, `Interested`, `Not Interested`, `Callback`, `No Answer` |
| Vapi Call ID | Single line text | Links the call back to the lead |
| Appointment Time | Date with time | Set when booked |
| Last Called | Date with time | |
| Call Summary | Long text | Written from the call summary |

## Setup

### 1. Accounts and credentials
- **Vapi:** get an API key and buy or import a phone number. Note the phone number ID.
- **Airtable:** create a personal access token with read/write on the base.
- **Google Calendar:** connect a Google account in n8n. `primary` is used by default. Change it in the `Google Calendar: Create Event` node if you want another calendar.
- **Gmail:** connect a Google account in n8n (the sending mailbox).
- **Slack:** connect a Slack app and create a `#sales-leads` channel.
- **n8n:** needs a public URL so Vapi can reach the webhooks (`https://<your-n8n>/webhook/...`).

### 2. Create the Vapi assistant
Replace `REPLACE_N8N_BASE_URL` in `vapi/assistant.json` with your n8n host, then:

```bash
curl -X POST https://api.vapi.ai/assistant \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d @lead-qualification/vapi/assistant.json
```

Save the returned `id`. It is the assistant ID.

### 3. Import the n8n workflows
1. In n8n, choose **Import from File** for each JSON file in `n8n/`.
2. Replace every `REPLACE_*` value:
   - `REPLACE_AIRTABLE_BASE_ID` and `REPLACE_AIRTABLE_LEADS_TABLE_ID` (in both workflows)
   - `REPLACE_VAPI_ASSISTANT_ID` and `REPLACE_VAPI_PHONE_NUMBER_ID` (workflow 1, `Vapi: Create Outbound Call`)
3. Attach your credentials to each node that shows a warning.
4. Activate both workflows.

### 4. Test it
1. Add a test lead with your own phone number and Status `New`. Workflow 1 should call you within about a minute.
2. Answer, say you are interested, and agree to a time. Check that the calendar event appears and the lead shows `Booked`.
3. Hang up. Check that the lead's Status, Call Summary and (if interested) the email and Slack message are correct.
4. Repeat with "not interested" and with no answer to exercise the other branches.

Offline checks (no accounts needed):
```bash
node lead-qualification/scripts/validate.mjs
```

## Compliance (please read before going live)
- Outbound AI calls are regulated. In the US, the TCPA requires prior express consent for automated calls to cell phones. Check your local rules (for example, the EU and UK have their own requirements).
- Only call leads who opted in. Add a `Do Not Call` status and filter it out before the call step.
- The agent identifies itself as an AI when asked, and honours removal requests (see the prompt rules in `vapi/assistant.json`).
- Limit the calling window (for example, 9:00–17:00 in the lead's time zone). This is not built in yet; add an IF node before `Vapi: Create Outbound Call` if you need it.

## Known limits and things to verify on first run
These parts were written against the public documentation of each tool, but I could not run them against live accounts here:

- **n8n node versions.** The Airtable trigger, Airtable and Google Calendar nodes change between versions. If an import shows a parameter as invalid, re-select the value in the node UI.
- **Airtable field shape.** Expressions use the flattened record shape (`$json.Email`, `$json.Name`). Some n8n versions nest fields under `fields`. The Vapi create-call node already handles both (`$json.fields?.Phone ?? $json.Phone`). Check the `Find Lead` nodes' output and adjust the `Gmail` and `Slack` expressions if they come back empty.
- **Vapi model name.** `claude-sonnet-5-5` is set under the Anthropic provider. Confirm it appears in Vapi's model list for your account, or switch to another model.
- **Vapi tool response shape.** The booking endpoint returns `{ "results": [{ "toolCallId", "result" }] }`, which is the format Vapi expects for server tools. Confirm it against the current tool-calling docs.
- **Vapi structured data.** The outcome comes from `analysisPlan.structuredDataSchema`. If the outcome is always `no_answer`, check that the analysis ran (it appears in the call log in the Vapi dashboard).
- **Time zones.** The agent must include the time zone offset in `start_time`. The booking node uses that value as given.
- **Retries and failures.** There is no retry queue. A failed booking is reported to the lead as "a team member will follow up", and the lead is left for manual follow-up.
