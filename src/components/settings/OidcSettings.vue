<template>
    <div>
        <div class="my-4">
            <div class="mb-3">
                <div class="form-check form-switch">
                    <input
                        id="oidc-enabled"
                        v-model="settings.oidcEnabled"
                        class="form-check-input"
                        type="checkbox"
                    />
                    <label class="form-check-label" for="oidc-enabled">
                        {{ $t("Enable OIDC") }}
                    </label>
                </div>
            </div>

            <div class="mb-3">
                <label for="oidc-issuer" class="form-label">{{ $t("OIDC Issuer URL") }}</label>
                <input
                    id="oidc-issuer"
                    v-model="settings.oidcIssuer"
                    type="url"
                    class="form-control"
                    placeholder="https://accounts.example.com"
                />
            </div>

            <div class="mb-3">
                <label for="oidc-client-id" class="form-label">{{ $t("OIDC Client ID") }}</label>
                <input
                    id="oidc-client-id"
                    v-model="settings.oidcClientId"
                    type="text"
                    class="form-control"
                />
            </div>

            <div class="mb-3">
                <label for="oidc-client-secret" class="form-label">{{ $t("OIDC Client Secret") }}</label>
                <input
                    id="oidc-client-secret"
                    v-model="settings.oidcClientSecret"
                    type="password"
                    class="form-control"
                    autocomplete="new-password"
                    :placeholder="$t('Leave blank to keep current secret')"
                />
            </div>

            <div class="mb-3">
                <label for="oidc-scopes" class="form-label">{{ $t("OIDC Scopes") }}</label>
                <input
                    id="oidc-scopes"
                    v-model="settings.oidcScopes"
                    type="text"
                    class="form-control"
                    placeholder="openid email profile"
                />
            </div>

            <div class="mb-3">
                <label for="oidc-callback-url" class="form-label">{{ $t("OIDC Callback URL") }}</label>
                <input
                    id="oidc-callback-url"
                    :value="callbackUrl"
                    type="text"
                    class="form-control"
                    readonly
                />
            </div>

            <button class="btn btn-primary" type="button" @click="save">
                {{ $t("Save") }}
            </button>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            settings: {
                oidcEnabled: false,
                oidcIssuer: "",
                oidcClientId: "",
                oidcClientSecret: "",
                oidcScopes: "openid email profile",
            },
            callbackUrl: "",
        };
    },

    mounted() {
        this.callbackUrl = window.location.origin + "/auth/oidc/callback";

        this.$root.getSocket().emit("getOidcSettings", (res) => {
            if (res.ok) {
                this.settings = Object.assign(this.settings, res.data);
            } else {
                this.$root.toastError(res.msg);
            }
        });
    },

    methods: {
        /**
         * Save OIDC settings to server
         * @returns {void}
         */
        save() {
            this.$root.getSocket().emit("setOidcSettings", this.settings, (res) => {
                this.$root.toastRes(res);
                if (res.ok) {
                    this.settings.oidcClientSecret = "";
                }
            });
        },
    },
};
</script>
