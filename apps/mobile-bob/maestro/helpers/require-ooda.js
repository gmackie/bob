// Maestro's JavaScript runtime supplies http and the flow's environment.
if (!OODA_API_URL || !/^https?:\/\//.test(OODA_API_URL)) {
  throw new Error("Set OODA_API_URL to the same OODA API URL used by the installed app.");
}
var baseUrl = OODA_API_URL.replace(/\/+$/, "");
var headers = {};
if (OODA_AUTH_COOKIE) headers.Cookie = OODA_AUTH_COOKIE;
if (OODA_AUTH_TOKEN) headers.Authorization = "Bearer " + OODA_AUTH_TOKEN;

function getJson(path) {
  var response;
  try {
    response = http.get(baseUrl + path, { headers: headers });
  } catch (error) {
    throw new Error("OODA preflight failed: gateway unreachable. Start the OODA API and check the app's OODA_API_URL.");
  }
  if (response.status !== 200) {
    // Do not print response bodies or credentials in review artifacts.
    throw new Error("OODA preflight failed: " + path + " returned HTTP " + response.status + ". Check gateway availability and the review account's authentication.");
  }
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new Error("OODA preflight failed: " + path + " did not return JSON. Check OODA_API_URL.");
  }
}

var rollout = getJson("/api/v1/rollout");
if (!rollout.capabilities || !rollout.capabilities.conversation_read || !rollout.capabilities.conversation_write) {
  throw new Error("OODA preflight failed: the review account needs conversation_read and conversation_write enabled.");
}
var conversations = getJson("/api/v1/conversations?status=active&limit=1");
if (!Array.isArray(conversations.items)) {
  throw new Error("OODA preflight failed: invalid conversation list response.");
}
