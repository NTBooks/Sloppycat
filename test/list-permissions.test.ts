import { describe, expect, it } from "vitest";
import { hostOf, isBuiltinListHost, listUrlProblem, originPatternFor } from "../src/lists/permissions";

describe("listUrlProblem", () => {
  it("accepts an https list URL on any host", () => {
    expect(listUrlProblem("https://raw.githubusercontent.com/a/b/main/sloppycat.md")).toBeUndefined();
    expect(listUrlProblem("https://janedoe.example/sloppycat.md")).toBeUndefined();
  });

  it("rejects plain http, because anyone on the path could rewrite the list", () => {
    expect(listUrlProblem("http://janedoe.example/sloppycat.md")).toMatch(/https/);
  });

  it("rejects things that are not URLs, or have no host to ask permission for", () => {
    expect(listUrlProblem("sloppycat.md")).toMatch(/not a URL/);
    expect(listUrlProblem("ftp://janedoe.example/sloppycat.md")).toMatch(/only fetch https/);
    expect(listUrlProblem("https://localhost/sloppycat.md")).toMatch(/no host name/);
  });
});

describe("originPatternFor", () => {
  it("narrows to the one host, keeping the grant as small as Chrome allows", () => {
    expect(originPatternFor("https://janedoe.example/lists/sloppycat.md")).toBe("https://janedoe.example/*");
  });

  it("keeps a port, since Chrome treats it as part of the origin", () => {
    expect(originPatternFor("https://janedoe.example:8443/sloppycat.md")).toBe("https://janedoe.example:8443/*");
  });

  it("has no pattern for a URL that could never be granted", () => {
    expect(originPatternFor("http://janedoe.example/sloppycat.md")).toBeUndefined();
    expect(originPatternFor("nonsense")).toBeUndefined();
  });
});

describe("isBuiltinListHost", () => {
  it("knows the hosts the manifest already covers, so they never prompt", () => {
    expect(isBuiltinListHost("https://raw.githubusercontent.com/a/b/main/sloppycat.md")).toBe(true);
    expect(isBuiltinListHost("https://gist.githubusercontent.com/jane/abc/raw")).toBe(true);
  });

  it("treats everything else as needing a grant", () => {
    expect(isBuiltinListHost("https://janedoe.example/sloppycat.md")).toBe(false);
    // Not a subdomain match: evil.githubusercontent.com.attacker.test must not pass as GitHub.
    expect(isBuiltinListHost("https://raw.githubusercontent.com.attacker.test/x.md")).toBe(false);
  });
});

describe("hostOf", () => {
  it("names the host for the permission prompt copy", () => {
    expect(hostOf("https://janedoe.example/sloppycat.md")).toBe("janedoe.example");
    expect(hostOf("  https://janedoe.example/a  ")).toBe("janedoe.example");
    expect(hostOf("nonsense")).toBeUndefined();
  });
});
