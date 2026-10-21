import test from "node:test";
import assert from "node:assert/strict";
import { createInterestClient, preferencePayload } from "../src/services/interestClient.js";

const choices = {
  reminders_enabled: false,
  marketing_enabled: false,
  personalization_enabled: false,
  reminder_lead_hours: 24,
};

test("saving reminder consent never enables marketing or submits another identity", async () => {
  let submitted;
  const api = createInterestClient({
    baseUrl: "/api/",
    getToken: async () => "verified-current-token",
    fetchImpl: async (url, options) => {
      submitted = { url, options };
      return {
        ok: true,
        json: async () => ({ preferences: JSON.parse(options.body), delivery: { enabled: false } }),
      };
    },
  });
  const result = await api.savePreferences({
    ...choices,
    reminders_enabled: true,
    id: 999,
    email: "other@example.invalid",
    timezone: "UTC",
  });
  assert.equal(submitted.url, "/api/me/preferences");
  assert.equal(submitted.options.method, "PUT");
  assert.deepEqual(JSON.parse(submitted.options.body), { ...choices, reminders_enabled: true });
  assert.equal(result.preferences.marketing_enabled, false);
  assert.equal(result.preferences.personalization_enabled, false);
  assert.equal(submitted.options.headers.Authorization, "Bearer verified-current-token");
});

test("every private request obtains the current token and rejects missing verified identity", async () => {
  let currentToken = "token-one";
  const seen = [];
  const api = createInterestClient({
    baseUrl: "/api",
    getToken: async () => currentToken,
    fetchImpl: async (url, options) => {
      seen.push(options.headers.Authorization);
      return { ok: true, json: async () => ({}) };
    },
  });
  await api.getPreferences();
  currentToken = "token-two";
  await api.getRecommendations();
  currentToken = null;
  await assert.rejects(api.savePreferences(choices), /verified email/);
  assert.deepEqual(seen, ["Bearer token-one", "Bearer token-two"]);
});

test("explicit unsubscribe sends token only in POST body and works without sign-in", async () => {
  const calls = [];
  const api = createInterestClient({
    baseUrl: "/api",
    getToken: () => {
      throw new Error("Public unsubscribe must not require authentication");
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ unsubscribed: true, scope: "marketing" }) };
    },
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(await api.unsubscribe("signed-link-token"), {
    unsubscribed: true,
    scope: "marketing",
  });
  assert.equal(calls[0].url, "/api/notifications/unsubscribe");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { token: "signed-link-token" });
});

test("invalid consent values and invalid reminder timing cannot be submitted", () => {
  for (const value of [undefined, null, "false", 0, 1]) {
    assert.throws(
      () => preferencePayload({ ...choices, marketing_enabled: value }),
      /Choose each preference/
    );
  }
  assert.throws(() => preferencePayload({ ...choices, reminder_lead_hours: 12 }), /reminder time/);
  assert.deepEqual(preferencePayload({ ...choices, reminder_lead_hours: 1 }), {
    ...choices,
    reminder_lead_hours: 1,
  });
});

test("expired unsubscribe and unavailable preferences expose helpful errors without response leakage", async () => {
  const api = createInterestClient({
    baseUrl: "/api",
    getToken: async () => "token",
    fetchImpl: async (url) => ({
      ok: false,
      status: url.includes("unsubscribe") ? 400 : 503,
      json: async () => ({ error: "private database detail" }),
    }),
  });
  await assert.rejects(api.unsubscribe("expired-token"), /invalid or expired/);
  await assert.rejects(
    api.getPreferences(),
    (error) =>
      error.message.includes("temporarily unavailable") && !error.message.includes("database")
  );
});

test('blocked accounts and rate limits are not confused with unverified email',async()=>{
  for(const [status,body,code] of [[403,{code:'account_disabled'},'account_disabled'],[403,{},'forbidden'],[429,{},'rate_limited']]) {
    const api=createInterestClient({baseUrl:'/api',getToken:async()=>'token',fetchImpl:async()=>({ok:false,status,json:async()=>body,headers:new Headers({'Retry-After':'60'})})});
    await assert.rejects(api.getPreferences(),error=>error.status===status&&error.code===code&&!error.message.includes('Verify your email'));
  }
});
