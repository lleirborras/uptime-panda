exports.up = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.text("oidc_sub").nullable().defaultTo(null);
        table.unique(["oidc_sub"]);
    });
};
exports.down = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.dropUnique(["oidc_sub"]);
        table.dropColumn("oidc_sub");
    });
};
