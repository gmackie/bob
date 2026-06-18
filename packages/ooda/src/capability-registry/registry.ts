import type { CapabilityDefinition, ToolProfile } from "./types";

export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityDefinition>();
  private profiles = new Map<string, ToolProfile>();

  registerCapability(capability: CapabilityDefinition): void {
    if (this.capabilities.has(capability.id)) {
      throw new Error(`Capability already registered: ${capability.id}`);
    }
    this.capabilities.set(capability.id, capability);
  }

  registerProfile(profile: ToolProfile): void {
    this.profiles.set(profile.id, profile);
  }

  getCapability(id: string): CapabilityDefinition | undefined {
    return this.capabilities.get(id);
  }

  getProfile(id: string): ToolProfile | undefined {
    return this.profiles.get(id);
  }

  listForProfile(profileId: string): CapabilityDefinition[] {
    const profile = this.profiles.get(profileId);
    if (!profile) return [];

    return profile.capabilityIds
      .map((id) => this.capabilities.get(id))
      .filter((c): c is CapabilityDefinition => c !== undefined);
  }

  listAll(): CapabilityDefinition[] {
    return [...this.capabilities.values()];
  }
}
