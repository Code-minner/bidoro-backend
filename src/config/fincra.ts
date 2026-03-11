// src/config/fincra.ts
import axios from "axios";

export const fincraConfig = {
  get apiKey()        { return process.env.FINCRA_API_KEY        || ""; },
  get businessId()    { return process.env.FINCRA_BUSINESS_ID    || ""; },
  get webhookSecret() { return process.env.FINCRA_WEBHOOK_SECRET || ""; },
  get baseUrl() {
    return process.env.NODE_ENV === "production"
      ? "https://api.fincra.com"
      : "https://sandboxapi.fincra.com";
  },
};

// Axios instance with dynamic api-key header (getter pattern avoids
// the static-header bug where the key is read once at startup)
export const fincraAPI = axios.create({
  get baseURL() {
    return fincraConfig.baseUrl;
  },
});

fincraAPI.interceptors.request.use((config) => {
  config.baseURL = fincraConfig.baseUrl;
  config.headers["api-key"] = fincraConfig.apiKey;
  return config;
});