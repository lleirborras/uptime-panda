exports.up = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.string("oidc_sub", 255).nullable().defaultTo(null);
        table.unique(["oidc_sub"]);
    });
};
exports.down = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.dropUnique(["oidc_sub"]);
        table.dropColumn("oidc_sub");
    });
};
