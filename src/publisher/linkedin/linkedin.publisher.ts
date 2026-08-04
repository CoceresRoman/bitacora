import { Inject, Injectable } from '@nestjs/common';
import { PublishedRef, PublisherPort } from '../../core/ports/publisher.port';
import { TokenStore } from './token.store';

export const LINKEDIN_API_VERSION = Symbol('LinkedInApiVersion');

const POSTS_URL = 'https://api.linkedin.com/rest/posts';

@Injectable()
export class LinkedInPublisher implements PublisherPort {
  constructor(
    private readonly tokens: TokenStore,
    @Inject(LINKEDIN_API_VERSION) private readonly apiVersion: string,
  ) {}

  async publish(text: string): Promise<PublishedRef> {
    const token = await this.tokens.current();
    if (!token) {
      throw new Error('LinkedIn is not connected. Visit /auth/linkedin first.');
    }

    const response = await fetch(POSTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'content-type': 'application/json',
        'LinkedIn-Version': this.apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: token.memberUrn,
        commentary: text,
        visibility: 'PUBLIC',
        lifecycleState: 'PUBLISHED',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!response.ok) {
      // Never include the token in the message.
      throw new Error(`LinkedIn returned ${response.status}: ${await response.text()}`);
    }

    const urn = response.headers.get('x-restli-id');
    if (!urn) {
      throw new Error('LinkedIn accepted the post but returned no x-restli-id header');
    }
    return { urn };
  }
}
