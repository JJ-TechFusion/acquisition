import arcjet, { shield, detectBot, slidingWindow } from '@arcjet/node';

const aj = arcjet({
  key: process.env.ARCJET_KEY,
  rules: [
    shield({ mode: 'LIVE' }),
    detectBot({
      mode: 'DRY_RUN', // Temporarily disabled for testing
      allow: [
        'CATEGORY:SEARCH_ENGINE', 
        'CATEGORY:PREVIEW',
        // Allow testing tools when explicitly enabled or in development
        ...(process.env.ALLOW_TESTING_TOOLS === 'true' || process.env.NODE_ENV !== 'production' 
          ? ['PostmanRuntime/*', 'insomnia/*', 'curl/*', 'Thunder Client/*'] 
          : [])
      ],
    }),
    slidingWindow({
      mode: 'LIVE',
      interval: '2s',
      max: 5,
    }),
  ],
});

export default aj;
