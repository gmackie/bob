"use strict";
// =============================================================================
// @bob/cookies/schema — Browser cookie jar and session cookie scopes.
//
// Tables (verbatim moves from packages/bob/src/db/src/schema.ts in
// Phase 7B-2 Task 19):
//   - browserCookies
//   - sessionCookieScopes
//
// Const-array enums:
//   - cookieSourceEnum
//   - sameSiteEnum
//
// Relations:
//   - browserCookiesRelations
//   - sessionCookieScopesRelations
//
// Cross-area imports:
//   - user from @bob/auth/schema
//   - chatConversations from @bob/chat/schema
// =============================================================================
var __makeTemplateObject = (this && this.__makeTemplateObject) || function (cooked, raw) {
    if (Object.defineProperty) { Object.defineProperty(cooked, "raw", { value: raw }); } else { cooked.raw = raw; }
    return cooked;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionCookieScopesRelations = exports.browserCookiesRelations = exports.sessionCookieScopes = exports.browserCookies = exports.sameSiteEnum = exports.cookieSourceEnum = void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
var auth_js_1 = require("./auth.js");
var chat_js_1 = require("./chat.js");
// ── Const-array enums ─────────────────────────────────────────────
exports.cookieSourceEnum = ["extension", "cli"];
exports.sameSiteEnum = ["Strict", "Lax", "None"];
// ── Browser Cookie Jar ─────────────────────────────────────────────
exports.browserCookies = (0, pg_core_1.pgTable)("browser_cookies", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    userId: t
        .text()
        .notNull()
        .references(function () { return auth_js_1.user.id; }, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    name: t.text().notNull(),
    valueCiphertext: t.text().notNull(),
    valueIv: t.text().notNull(),
    valueTag: t.text().notNull(),
    path: t.text().notNull().default("/"),
    expires: t.timestamp({ mode: "string", withTimezone: true }),
    secure: t.boolean().notNull().default(false),
    httpOnly: t.boolean().notNull().default(false),
    sameSite: t.varchar({ length: 10 }).notNull().default("Lax"),
    source: t.varchar({ length: 20 }).notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
    updatedAt: t
        .timestamp({ mode: "string", withTimezone: true })
        .$onUpdateFn(function () { return (0, drizzle_orm_1.sql)(templateObject_1 || (templateObject_1 = __makeTemplateObject(["now()"], ["now()"]))); }),
}); }, function (table) { return [
    (0, pg_core_1.uniqueIndex)("browser_cookies_user_domain_name_path_idx").on(table.userId, table.domain, table.name, table.path),
    (0, pg_core_1.index)("browser_cookies_user_domain_idx").on(table.userId, table.domain),
]; });
exports.sessionCookieScopes = (0, pg_core_1.pgTable)("session_cookie_scopes", function (t) { return ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    sessionId: t
        .uuid()
        .notNull()
        .references(function () { return chat_js_1.chatConversations.id; }, { onDelete: "cascade" }),
    domain: t.text().notNull(),
    createdAt: t.timestamp({ mode: "string" }).defaultNow().notNull(),
}); }, function (table) { return [
    (0, pg_core_1.uniqueIndex)("session_cookie_scopes_session_domain_idx").on(table.sessionId, table.domain),
]; });
// =============================================================================
// Relations
// =============================================================================
exports.browserCookiesRelations = (0, drizzle_orm_1.relations)(exports.browserCookies, function (_a) {
    var one = _a.one;
    return ({
        user: one(auth_js_1.user, {
            fields: [exports.browserCookies.userId],
            references: [auth_js_1.user.id],
        }),
    });
});
exports.sessionCookieScopesRelations = (0, drizzle_orm_1.relations)(exports.sessionCookieScopes, function (_a) {
    var one = _a.one;
    return ({
        session: one(chat_js_1.chatConversations, {
            fields: [exports.sessionCookieScopes.sessionId],
            references: [chat_js_1.chatConversations.id],
        }),
    });
});
var templateObject_1;
