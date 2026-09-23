import { describe, expect, it } from "vitest";
import { EDITABLE_KEYS, MEMBER_FIELDS, PERMISSION_OPTIONS, TEXT_FIELDS, changedFields, isDirty } from "../../app/console/src/lib/org-settings";

const original = {
  login: "org", name: "长江大学极客班", description: null, blog: "https://example.test",
  default_repository_permission: "read", members_can_create_repositories: true, members_can_delete_repositories: false,
};

describe("organization settings form", () => {
  it("is clean when nothing changed", () => {
    expect(isDirty(original, { ...original })).toBe(false);
    expect(changedFields(original, { ...original })).toEqual({});
  });

  it("reports only the fields that differ", () => {
    const draft = { ...original, name: "极客班", members_can_delete_repositories: true };
    expect(changedFields(original, draft)).toEqual({ name: "极客班", members_can_delete_repositories: true });
    expect(isDirty(original, draft)).toBe(true);
  });

  it("stops counting a field once it is changed back", () => {
    const draft = { ...original, name: "极客班" };
    expect(isDirty(original, draft)).toBe(true);
    draft.name = original.name;
    expect(isDirty(original, draft)).toBe(false);
  });

  it("treats null and an empty string as the same value", () => {
    expect(changedFields(original, { ...original, description: "" })).toEqual({});
    expect(changedFields(original, { ...original, description: "简介" })).toEqual({ description: "简介" });
  });

  it("never sends read-only fields such as the login", () => {
    expect(changedFields(original, { ...original, login: "renamed" })).toEqual({});
    expect(EDITABLE_KEYS).not.toContain("login");
  });

  it("matches the server's accepted permission values and editable checkbox fields", () => {
    expect(PERMISSION_OPTIONS.map(o => o.value)).toEqual(["none", "read", "write", "admin"]);
    expect(MEMBER_FIELDS.every(f => f.key.startsWith("members_can_"))).toBe(true);
    expect(new Set(TEXT_FIELDS.map(f => f.key)).size).toBe(TEXT_FIELDS.length);
  });
});
