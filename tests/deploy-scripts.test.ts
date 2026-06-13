import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const scripts = [
  "deploy/update-macos-service.sh",
  "deploy/check-macos-services.sh"
];

describe("macOS 운영 스크립트", () => {
  it.each(scripts)("%s shell 문법이 유효하고 실행 가능함", (path) => {
    expect(spawnSync("sh", ["-n", path], { encoding: "utf8" })).toMatchObject({
      status: 0,
      stderr: ""
    });
    expect(statSync(path).mode & 0o111).not.toBe(0);
  });

  it("업데이트 스크립트는 검증과 build 후에 서비스를 재시작함", () => {
    const script = readFileSync("deploy/update-macos-service.sh", "utf8");
    expect(script.indexOf("npm run typecheck")).toBeLessThan(script.indexOf("launchctl kickstart"));
    expect(script.indexOf("npm test")).toBeLessThan(script.indexOf("launchctl kickstart"));
    expect(script.indexOf("npm run build")).toBeLessThan(script.indexOf("launchctl kickstart"));
    expect(script.indexOf("launchctl kickstart")).toBeLessThan(script.indexOf("curl -fsS"));
  });
});
