const { describe, test } = require("node:test");
const assert = require("node:assert");
const { SNMPMonitorType } = require("../../../server/monitor-types/snmp");
const { PENDING } = require("../../../src/util");

describe("SNMP Monitor", () => {
    test("check() rejects when bind_interface is an address not on this host (192.0.2.1)", async () => {
        const snmpMonitor = new SNMPMonitorType();
        const monitor = {
            hostname: "127.0.0.1",
            port: "16100",
            snmp_oid: "1.3.6.1.2.1.1.1.0",
            snmp_version: "1",
            radius_password: "public",
            maxretries: 0,
            timeout: 3,
            json_path_operator: "equals",
            expected_value: "anything",
            bind_interface: "192.0.2.1",
        };
        const heartbeat = { msg: "", status: PENDING };

        await assert.rejects(snmpMonitor.check(monitor, heartbeat, {}), /.+/);
    });

    test("check() rejects when SNMP server is not reachable (no bind_interface)", async () => {
        const snmpMonitor = new SNMPMonitorType();
        const monitor = {
            hostname: "127.0.0.1",
            port: "16100",
            snmp_oid: "1.3.6.1.2.1.1.1.0",
            snmp_version: "1",
            radius_password: "public",
            maxretries: 0,
            timeout: 2,
            json_path_operator: "equals",
            expected_value: "anything",
        };
        const heartbeat = { msg: "", status: PENDING };

        await assert.rejects(snmpMonitor.check(monitor, heartbeat, {}), /.+/);
    });
});
