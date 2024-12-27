export class LayerZeroError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LayerZeroError";
    }
  }
  
export class CCTPapiError extends Error {
constructor(message: string) {
    super(message);
    this.name = "CCTPapiError";
}
}

export class SquidapiError extends Error {
  constructor(message: string) {
      super(message);
      this.name = "SquidapiError";
}
}