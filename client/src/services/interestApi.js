import { API_BASE } from "./apiService";
import { getVerifiedIdToken } from "./authToken";
import { createInterestClient } from "./interestClient";

export const interestApi = createInterestClient({
  baseUrl: API_BASE,
  getToken: getVerifiedIdToken,
});
