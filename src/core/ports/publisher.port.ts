export interface PublishedRef {
  urn: string;
}

export interface PublisherPort {
  publish(text: string): Promise<PublishedRef>;
}

export const PUBLISHER_PORT = Symbol('PublisherPort');
