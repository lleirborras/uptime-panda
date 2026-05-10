const { describe, test } = require("node:test");
const assert = require("node:assert");
const { DnsMonitorType } = require("../../../server/monitor-types/dns");

describe("DNS Monitor", () => {
    test("dnsResolve() rejects when bind_interface is an address not on this host (192.0.2.1)", async () => {
        const dnsMonitor = new DnsMonitorType();

        await assert.rejects(
            dnsMonitor.dnsResolve("example.com", ["1.1.1.1"], "53", "A", "192.0.2.1"),
            /.+/
        );
    });
});
