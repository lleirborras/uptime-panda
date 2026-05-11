exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.string("bind_interface", 255).nullable().defaultTo(null);
    });
};
exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("bind_interface");
    });
};
