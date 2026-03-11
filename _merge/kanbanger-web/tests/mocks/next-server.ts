type NextHeaders = {
  get: (name: string) => string | null;
};

class HeadersAdapter {
  private readonly values = new Map<string, string>();

  constructor(init?: Record<string, string> | Headers) {
    if (init instanceof Headers) {
      init.forEach((value, key) => {
        this.values.set(key.toLowerCase(), value);
      });
      return;
    }

    if (init) {
      for (const [key, value] of Object.entries(init)) {
        this.values.set(key.toLowerCase(), value);
      }
    }
  }

  get(name: string) {
    return this.values.get(name.toLowerCase()) ?? null;
  }
}

export class NextRequest {
  public url: string;
  private readonly rawBody: string;
  public headers: NextHeaders;

  public constructor(
    input: string | URL | Request,
    init?: {
      headers?: Record<string, string> | Headers;
      body?: string | Record<string, unknown> | object | null;
    }
  ) {
    if (input instanceof URL) {
      this.url = input.toString();
    } else {
      this.url = String(input);
    }

    this.headers = new HeadersAdapter(init?.headers);
    const body = init?.body;

    if (typeof body === "string") {
      this.rawBody = body;
    } else if (body == null) {
      this.rawBody = "";
    } else {
      this.rawBody = JSON.stringify(body);
    }
  }

  public json<T = Record<string, unknown>>() {
    if (!this.rawBody) {
      return Promise.resolve({}) as Promise<T>;
    }

    return Promise.resolve(JSON.parse(this.rawBody)) as Promise<T>;
  }

  public text() {
    return Promise.resolve(this.rawBody);
  }
}

export class NextResponse {
  public static json<T>(data: T, init?: { status?: number }) {
    return {
      status: init?.status ?? 200,
      body: JSON.stringify(data),
      json: () => Promise.resolve(data),
    };
  }
}
