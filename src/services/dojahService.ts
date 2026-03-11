// backend/services/dojahService.ts

const DOJAH_BASE_URL = "https://sandbox.dojah.io"; // Switch to https://api.dojah.io in production

interface NINVerificationResult {
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  photo?: string;
}

interface DojahNINEntity {
  firstname: string;
  surname: string;
  middlename?: string;
  birthdate?: string;
  gender?: string;
  phone?: string;
  photo?: string;
  nin?: string;
}

interface DojahNINResponse {
  entity?: DojahNINEntity; // ✅ Optional — error responses won't have this
  error?: string;
  message?: string;
}

class DojahService {
  private appId: string;
  private secretKey: string;

  constructor() {
    this.appId = process.env.DOJAH_APP_ID!;
    this.secretKey = process.env.DOJAH_SECRET_KEY!;

    if (!this.appId || !this.secretKey) {
      console.warn("⚠️ Dojah credentials not configured");
    }
  }

  private get headers() {
    return {
      AppId: this.appId,
      Authorization: this.secretKey,
      "Content-Type": "application/json",
    };
  }

  async verifyNIN(nin: string): Promise<NINVerificationResult> {
    console.log("\n=== DOJAH NIN VERIFICATION ===");
    console.log("NIN:", nin);

    const response = await fetch(
      `${DOJAH_BASE_URL}/api/v1/kyc/nin?nin=${nin}`,
      {
        method: "GET",
        headers: this.headers,
      }
    );

    console.log("Dojah response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Dojah error response:", errorText);

      if (response.status === 400) {
        throw new Error("Invalid NIN provided");
      }
      if (response.status === 402) {
        throw new Error("Insufficient Dojah credits");
      }
      if (response.status === 404) {
        throw new Error("NIN not found in government database");
      }
      throw new Error(`Dojah verification failed: ${response.status}`);
    }

    const data = (await response.json()) as DojahNINResponse;
    console.log("Dojah NIN data:", JSON.stringify(data, null, 2));

    if (!data?.entity) {
      throw new Error("NIN verification returned no data");
    }

    const entity: DojahNINEntity = data.entity;

    return {
      firstName: entity.firstname,
      lastName: entity.surname,
      middleName: entity.middlename,
      dateOfBirth: entity.birthdate,
      gender: entity.gender,
      phone: entity.phone,
      photo: entity.photo,
    };
  }

  async verifyNINWithPhoto(nin: string): Promise<NINVerificationResult> {
    console.log("\n=== DOJAH NIN WITH PHOTO VERIFICATION ===");
    console.log("NIN:", nin);

    const response = await fetch(
      `${DOJAH_BASE_URL}/api/v1/kyc/nin/photo?nin=${nin}`,
      {
        method: "GET",
        headers: this.headers,
      }
    );

    console.log("Dojah photo response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Dojah photo NIN error:", errorText);

      if (response.status === 400) {
        throw new Error("Invalid NIN provided");
      }
      if (response.status === 402) {
        throw new Error("Insufficient Dojah credits");
      }
      if (response.status === 404) {
        throw new Error("NIN not found in government database");
      }
      throw new Error("NIN photo verification failed");
    }

    const data = (await response.json()) as DojahNINResponse;
    console.log("Dojah NIN photo data:", JSON.stringify(data, null, 2));

    if (!data?.entity) {
      throw new Error("NIN verification returned no data");
    }

    const entity: DojahNINEntity = data.entity;

    return {
      firstName: entity.firstname,
      lastName: entity.surname,
      middleName: entity.middlename,
      dateOfBirth: entity.birthdate,
      gender: entity.gender,
      phone: entity.phone,
      photo: entity.photo,
    };
  }
}

const dojahService = new DojahService();
export default dojahService;