# Make.com version of the lead qualification workflow

The same flow as the n8n version, split into three Make scenarios. Each file is a scenario blueprint you import with **Import Blueprint**.

| File | Scenario | What it does |
|---|---|---|
| `1-outbound-call.blueprint.json` | Lead intake & outbound call | Airtable new lead → Vapi `POST /call` → Airtable (Status `Calling`, store Vapi Call ID) |
| `2-call-result-routing.blueprint.json` | Vapi end-of-call routing | Webhook → filter end-of-call → Match pattern (email) → Set variables → Airtable find lead → Router: Interested (Airtable, Gmail, Slack) / Not Interested (Airtable) / Callback or No Answer (Airtable) |
| `3-book-appointment-tool.blueprint.json` | Booking tool endpoint | Webhook from the Vapi `book_appointment` tool → Google Calendar event → Airtable (Status `Booked`) → webhook response that Vapi reads back to the caller |

Scenario 1 and 2/3 are separate because Make's webhook scenarios must be running for Vapi to reach them, and the booking tool needs a synchronous reply.

## Setup

1. **Create the Airtable base** exactly as in the main README (`lead-qualification/README.md`, section "Airtable setup").
2. **Create the Vapi assistant** from `lead-qualification/vapi/assistant.json`. In that file, replace `REPLACE_N8N_BASE_URL` with your Make webhook base URL, or change the URLs to the Make hook URLs after step 4. The `server.url` for end-of-call events should point at scenario 2's webhook; the `book_appointment` tool's `server.url` at scenario 3's webhook.
3. **Import** each blueprint: in Make, open a new scenario, click the `…` menu in the upper right, choose **Import Blueprint**, and select the file.
4. **Create the webhooks.** In scenarios 2 and 3, click the webhook module, choose **Add**, name the hook, and copy its URL. Copy the hook's ID into the `hook` field (the `REPLACE_*_WEBHOOK_ID` placeholder).
5. **Replace placeholders:**
   - `REPLACE_AIRTABLE_BASE_ID` and `REPLACE_AIRTABLE_LEADS_TABLE_ID` (all scenarios)
   - `REPLACE_VAPI_API_KEY`, `REPLACE_VAPI_ASSISTANT_ID`, `REPLACE_VAPI_PHONE_NUMBER_ID` (scenario 1). Better: store the key in a Make connection or data store, not in the blueprint.
   - `REPLACE_SLACK_CHANNEL_ID` (scenario 2)
   - `REPLACE_*_WEBHOOK_ID` (scenarios 2 and 3)
6. **Connect accounts.** Each module that shows a connection warning needs one: Airtable, Gmail, Slack, Google Calendar.
7. **Turn on** scenario 1 (its schedule should poll Airtable every few minutes) and scenarios 2 and 3 (they must be on to receive webhooks).

## Test
Same as the main README: add a test lead with your phone number and Status `New`, answer, agree to a time, hang up, then check Airtable, the calendar, email and Slack. Make's **History** tab shows each run and every module's input and output, which is the quickest way to find a broken mapping.

## Known limits and what to verify on import

I wrote these blueprints from Make's blueprint format, and the module names and parameter keys are my best reading of it, not confirmed against a live Make account. A web search for the exact identifiers did not return usable schema. **Expect to fix a few things on first import:**

- **Module names.** Confirm `airtable:TriggerNewRecords`, `airtable:ActionSearchRecords`, `airtable:ActionUpdateRecord`, `google-email:ActionSendEmail`, `slack:ActionSendMessageToChannel`, `google-calendar:ActionCreateEvent`, `gateway:CustomWebHook`, `gateway:WebhookRespond`, `http:ActionSendData`, `text:MatchPattern`, `builtin:BasicFilter`, `builtin:BasicSetVariables` and `builtin:BasicRouter`. If Make shows a module as missing or unknown, add it again from the module picker and copy the fields across.
- **Module parameters.** Some modules expect different keys (for example, the Airtable record ID key and the Slack channel selector). Open each module after import and re-select values from the dropdowns.
- **Filters.** Scenario 2's filter is a separate `builtin:BasicFilter` module. In Make, filters can also be attached to a route. If the filter does not behave as expected in History, move the condition onto the route.
- **Match pattern.** The regex in the `text:MatchPattern` module pulls an email from the call summary. If Make gives a different output key than `match`, update the `extractedEmail` reference in the `Set variables` module.
- **Date handling.** The booking scenario computes the calendar end time as start + 30 minutes using `parseDate` and `addMinutes`. The format string must match the ISO strings Vapi sends. Check the first booking run in History.
- **Array indexes.** Make's search results are arrays. The blueprints use `5[1]` for the first matched lead. If a search returns no records, the Interested branch's Gmail and Slack steps will read empty values.
- **Booking failures.** If the calendar or Airtable step fails, the response to Vapi is not sent and the agent says the booking failed. Add a Make error handler (a route on the failing module) if you want the response sent on error.
- **Compliance.** See the main README. Outbound AI calling needs consent, Do Not Call filtering and calling-hours limits, which are not built into these scenarios.
