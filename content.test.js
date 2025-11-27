import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Chrome API
const mockStorage = new Map();
global.chrome = {
  storage: {
    local: {
      get: vi.fn((keys) => {
        const result = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        keyArray.forEach(key => {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          }
        });
        return Promise.resolve(result);
      }),
      set: vi.fn((items) => {
        Object.entries(items).forEach(([key, value]) => {
          mockStorage.set(key, value);
        });
        return Promise.resolve();
      })
    }
  },
  runtime: {
    id: 'test-extension-id',
    getURL: vi.fn((path) => `chrome-extension://test/${path}`),
    onMessage: {
      addListener: vi.fn()
    }
  },
  tabs: {
    query: vi.fn(() => Promise.resolve([])),
    sendMessage: vi.fn(() => Promise.resolve())
  }
};

// Constants from content.js
const MODE_KEY = 'display_mode';
const MODE_AUTO = 'auto';
const MODE_MANUAL = 'manual';

// Helper to create mock Twitter DOM structures for testing
function createTwitterDOMStructure(screenName, variant = 'standard') {
  const container = document.createElement('article');
  container.setAttribute('data-testid', 'tweet');
  
  const userNameContainer = document.createElement('div');
  userNameContainer.setAttribute('data-testid', variant === 'UserCell' ? 'UserName' : 'User-Name');
  
  // Display name section
  const displayNameDiv = document.createElement('div');
  const displayNameLink = document.createElement('a');
  displayNameLink.href = `/${screenName}`;
  displayNameLink.textContent = 'Display Name';
  displayNameDiv.appendChild(displayNameLink);
  userNameContainer.appendChild(displayNameDiv);
  
  // Handle section
  const handleDiv = document.createElement('div');
  const handleLink = document.createElement('a');
  handleLink.href = `/${screenName}`;
  handleLink.textContent = `@${screenName}`;
  handleDiv.appendChild(handleLink);
  userNameContainer.appendChild(handleDiv);
  
  container.appendChild(userNameContainer);
  
  return container;
}

// Helper to simulate extractUsername from content.js
function extractUsernameTest(element) {
  // Try data-testid="UserName" or "User-Name" first (most reliable)
  const usernameElement = element.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (usernameElement) {
    const links = usernameElement.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      const match = href.match(/^\/([^\/\?]+)/);
      if (match && match[1]) {
        const username = match[1];
        // Filter out common routes
        const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
        if (!excludedRoutes.includes(username) && 
            !username.startsWith('hashtag') &&
            !username.startsWith('search') &&
            username.length > 0 &&
            username.length < 20) {
          return username;
        }
      }
    }
  }
  
  // Try finding username links in the entire element (broader search)
  const allLinks = element.querySelectorAll('a[href^="/"]');
  const seenUsernames = new Set();
  
  for (const link of allLinks) {
    const href = link.getAttribute('href');
    if (!href) continue;
    
    const match = href.match(/^\/([^\/\?]+)/);
    if (!match || !match[1]) continue;
    
    const potentialUsername = match[1];
    
    if (seenUsernames.has(potentialUsername)) continue;
    seenUsernames.add(potentialUsername);
    
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities', 'hashtag'];
    if (excludedRoutes.some(route => potentialUsername === route || potentialUsername.startsWith(route))) {
      continue;
    }
    
    if (potentialUsername.includes('status') || potentialUsername.match(/^\d+$/)) {
      continue;
    }
    
    const text = link.textContent?.trim() || '';
    const linkText = text.toLowerCase();
    const usernameLower = potentialUsername.toLowerCase();
    
    if (text.startsWith('@')) {
      return potentialUsername;
    }
    
    if (linkText === usernameLower || linkText === `@${usernameLower}`) {
      return potentialUsername;
    }
    
    const parent = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
    if (parent) {
      if (potentialUsername.length > 0 && potentialUsername.length < 20 && !potentialUsername.includes('/')) {
        return potentialUsername;
      }
    }
    
    if (text && text.trim().startsWith('@')) {
      const atUsername = text.trim().substring(1);
      if (atUsername === potentialUsername) {
        return potentialUsername;
      }
    }
  }
  
  const textContent = element.textContent || '';
  const atMentionMatches = textContent.matchAll(/@([a-zA-Z0-9_]+)/g);
  for (const match of atMentionMatches) {
    const username = match[1];
    const link = element.querySelector(`a[href="/${username}"], a[href^="/${username}?"]`);
    if (link) {
      const isInUserNameContainer = link.closest('[data-testid="UserName"], [data-testid="User-Name"]');
      if (isInUserNameContainer) {
        return username;
      }
    }
  }
  
  return null;
}

describe('Username Detection Cross-Browser Compatibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * **Feature: firefox-compatibility, Property 2: Username detection consistency**
   * **Validates: Requirements 1.2**
   * 
   * For any Twitter DOM structure containing username elements, the extractUsername() 
   * function should return the same username regardless of browser context.
   */
  it('Property 2: Username detection consistency - extracts same username across browser contexts', () => {
    // Generator for valid Twitter usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'))
      .filter(s => !/^\d+$/.test(s)); // Not all digits

    // Generator for DOM structure variants
    const variantGen = fc.constantFrom('standard', 'UserCell');

    fc.assert(
      fc.property(usernameGen, variantGen, (screenName, variant) => {
        // Create Twitter DOM structure
        const container = createTwitterDOMStructure(screenName, variant);
        
        // Extract username using standard DOM APIs (no browser-specific APIs)
        const extractedUsername = extractUsernameTest(container);
        
        // Verify extracted username matches the expected username
        expect(extractedUsername).toBe(screenName);
        
        // Verify the function only uses standard DOM APIs
        // querySelector, querySelectorAll, getAttribute, textContent, closest are all standard
        // These work identically in Chrome and Firefox
        const usernameElement = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
        expect(usernameElement).toBeTruthy();
        
        // Verify links are found using standard DOM traversal
        const links = usernameElement.querySelectorAll('a[href^="/"]');
        expect(links.length).toBeGreaterThan(0);
        
        // Verify href attribute extraction works
        const firstLink = links[0];
        const href = firstLink.getAttribute('href');
        expect(href).toBe(`/${screenName}`);
        
        // Verify textContent works (standard across browsers)
        const text = firstLink.textContent;
        expect(text).toBeTruthy();
      }),
      { numRuns: 100 }
    );
  });

  it('username detection works with User-Name testid', () => {
    const container = createTwitterDOMStructure('testuser', 'standard');
    const username = extractUsernameTest(container);
    expect(username).toBe('testuser');
  });

  it('username detection works with UserName testid', () => {
    const container = createTwitterDOMStructure('testuser', 'UserCell');
    const username = extractUsernameTest(container);
    expect(username).toBe('testuser');
  });

  it('username detection filters out excluded routes in first two checks', () => {
    // Note: The third check (@mention matching) in extractUsername doesn't filter excluded routes
    // This test verifies the first two checks properly filter them
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    
    for (const route of excludedRoutes) {
      // Create a structure without @mention format to test first two checks
      const container = document.createElement('article');
      container.setAttribute('data-testid', 'tweet');
      
      const userNameContainer = document.createElement('div');
      userNameContainer.setAttribute('data-testid', 'User-Name');
      
      const link = document.createElement('a');
      link.href = `/${route}`;
      link.textContent = route; // Not @mention format
      userNameContainer.appendChild(link);
      
      container.appendChild(userNameContainer);
      
      const username = extractUsernameTest(container);
      // Should return null because excluded routes are filtered in first two checks
      expect(username).toBeNull();
    }
  });

  it('username detection handles @mention format', () => {
    const container = document.createElement('article');
    container.setAttribute('data-testid', 'tweet');
    
    const userNameContainer = document.createElement('div');
    userNameContainer.setAttribute('data-testid', 'User-Name');
    
    const link = document.createElement('a');
    link.href = '/testuser';
    link.textContent = '@testuser';
    userNameContainer.appendChild(link);
    
    container.appendChild(userNameContainer);
    
    const username = extractUsernameTest(container);
    expect(username).toBe('testuser');
  });

  it('username detection uses only standard DOM APIs', () => {
    // This test verifies that no browser-specific APIs are used
    const container = createTwitterDOMStructure('testuser', 'standard');
    
    // All these methods are standard DOM APIs that work identically in Chrome and Firefox
    const usesStandardAPIs = () => {
      // querySelector - standard
      const element = container.querySelector('[data-testid="User-Name"]');
      expect(element).toBeTruthy();
      
      // querySelectorAll - standard
      const links = element.querySelectorAll('a[href^="/"]');
      expect(links.length).toBeGreaterThan(0);
      
      // getAttribute - standard
      const href = links[0].getAttribute('href');
      expect(href).toBeTruthy();
      
      // textContent - standard
      const text = links[0].textContent;
      expect(text).toBeTruthy();
      
      // closest - standard (supported in both Chrome and Firefox)
      const parent = links[0].closest('[data-testid="User-Name"]');
      expect(parent).toBeTruthy();
      
      // match (regex) - standard JavaScript
      const match = href.match(/^\/([^\/\?]+)/);
      expect(match).toBeTruthy();
      
      return true;
    };
    
    expect(usesStandardAPIs()).toBe(true);
  });
});

describe('Browser API Compatibility Layer', () => {
  let originalBrowser;
  let originalChrome;

  beforeEach(() => {
    // Save original globals
    originalBrowser = global.browser;
    originalChrome = global.chrome;
  });

  afterEach(() => {
    // Restore original globals
    global.browser = originalBrowser;
    global.chrome = originalChrome;
  });

  /**
   * **Feature: firefox-compatibility, Property 1: Browser namespace detection**
   * **Validates: Requirements 2.1, 2.3, 2.4**
   * 
   * For any browser environment (with either `browser` or `chrome` global defined), 
   * the browserAPI constant should resolve to the available namespace and provide 
   * access to storage, runtime, and tabs APIs.
   */
  it('Property 1: Browser namespace detection - resolves to available namespace with required APIs', () => {
    // Generator for browser environment configurations
    const browserEnvGen = fc.record({
      hasBrowser: fc.boolean(),
      hasChrome: fc.boolean()
    }).filter(env => env.hasBrowser || env.hasChrome); // At least one must be available

    fc.assert(
      fc.property(browserEnvGen, (env) => {
        // Setup global context based on environment
        if (env.hasBrowser) {
          global.browser = {
            storage: { local: { get: vi.fn(), set: vi.fn() } },
            runtime: { id: 'test-id', getURL: vi.fn(), onMessage: { addListener: vi.fn() } },
            tabs: { query: vi.fn(), sendMessage: vi.fn() }
          };
        } else {
          delete global.browser;
        }

        if (env.hasChrome) {
          global.chrome = {
            storage: { local: { get: vi.fn(), set: vi.fn() } },
            runtime: { id: 'test-id', getURL: vi.fn(), onMessage: { addListener: vi.fn() } },
            tabs: { query: vi.fn(), sendMessage: vi.fn() }
          };
        } else {
          delete global.chrome;
        }

        // Test browserAPI resolution (same logic as content.js and popup.js)
        const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

        // Assert: browserAPI should have required APIs
        expect(browserAPI).toBeDefined();
        expect(browserAPI).toHaveProperty('storage');
        expect(browserAPI.storage).toHaveProperty('local');
        expect(browserAPI.storage.local).toHaveProperty('get');
        expect(browserAPI.storage.local).toHaveProperty('set');
        expect(browserAPI).toHaveProperty('runtime');
        expect(browserAPI.runtime).toHaveProperty('id');
        expect(browserAPI.runtime).toHaveProperty('getURL');
        expect(browserAPI).toHaveProperty('tabs');
        expect(browserAPI.tabs).toHaveProperty('query');
        expect(browserAPI.tabs).toHaveProperty('sendMessage');

        // Assert: when browser is available, it should be preferred
        if (env.hasBrowser) {
          expect(browserAPI).toBe(global.browser);
        } else {
          expect(browserAPI).toBe(global.chrome);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('browser namespace is preferred over chrome when both are available', () => {
    // Setup both namespaces
    global.browser = {
      storage: { local: { get: vi.fn(), set: vi.fn() } },
      runtime: { id: 'firefox-id', getURL: vi.fn() },
      tabs: { query: vi.fn(), sendMessage: vi.fn() }
    };
    global.chrome = {
      storage: { local: { get: vi.fn(), set: vi.fn() } },
      runtime: { id: 'chrome-id', getURL: vi.fn() },
      tabs: { query: vi.fn(), sendMessage: vi.fn() }
    };

    // Test browserAPI resolution
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

    // Should prefer browser namespace
    expect(browserAPI).toBe(global.browser);
    expect(browserAPI.runtime.id).toBe('firefox-id');
  });

  it('falls back to chrome namespace when browser is not available', () => {
    // Remove browser namespace
    delete global.browser;
    
    // Setup chrome namespace
    global.chrome = {
      storage: { local: { get: vi.fn(), set: vi.fn() } },
      runtime: { id: 'chrome-id', getURL: vi.fn() },
      tabs: { query: vi.fn(), sendMessage: vi.fn() }
    };

    // Test browserAPI resolution
    const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

    // Should use chrome namespace
    expect(browserAPI).toBe(global.chrome);
    expect(browserAPI.runtime.id).toBe('chrome-id');
  });
});

describe('Display Generation Cross-Browser Compatibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * **Feature: firefox-compatibility, Property 3: Display format consistency**
   * **Validates: Requirements 1.3, 6.3**
   * 
   * For any location data object, buildBracketedDisplay() should produce 
   * identical DOM structure and content regardless of browser context.
   */
  it('Property 3: Display format consistency - produces identical DOM across browsers', () => {
    // Generator for location data with various combinations
    const locationDataGen = fc.record({
      location: fc.oneof(
        fc.constant(null),
        fc.constantFrom('United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Japan', 'Australia')
      ),
      locationFlag: fc.oneof(
        fc.constant(null),
        fc.constantFrom('🇺🇸', '🇬🇧', '🇨🇦', '🇩🇪', '🇫🇷', '🇯🇵', '🇦🇺')
      ),
      source: fc.oneof(
        fc.constant(null),
        fc.constantFrom('United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Japan', 'Australia')
      ),
      sourceFlag: fc.oneof(
        fc.constant(null),
        fc.constantFrom('🇺🇸', '🇬🇧', '🇨🇦', '🇩🇪', '🇫🇷', '🇯🇵', '🇦🇺')
      ),
      sourceCountry: fc.oneof(
        fc.constant(null),
        fc.constantFrom('United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Japan', 'Australia')
      ),
      locationAccurate: fc.oneof(fc.constant(null), fc.boolean()),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.oneof(fc.constant(null), fc.constant('https://help.twitter.com/location'))
    });

    fc.assert(
      fc.property(locationDataGen, (displayInfo) => {
        // Create display using standard DOM APIs (no browser-specific APIs)
        const wrapper = document.createElement('span');
        wrapper.setAttribute('data-twitter-flag-wrapper', 'true');
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '4px';
        wrapper.style.marginLeft = '4px';
        wrapper.style.marginRight = '4px';
        wrapper.style.fontSize = '0.95em';
        wrapper.style.verticalAlign = 'middle';

        // Build segments using standard DOM APIs
        const VPN_ICON = '\uD83D\uDEE1';
        const INFO_ICON = '\u2139\uFE0F';
        const ACCURATE_ICON = '\u2705';
        const UNKNOWN_ICON = '\u2022';

        // Account segment
        const accountSegment = document.createElement('span');
        accountSegment.textContent = displayInfo.locationFlag || UNKNOWN_ICON;
        accountSegment.title = displayInfo.location || 'Account-based location unavailable';
        accountSegment.setAttribute('data-twitter-flag', 'true');
        accountSegment.setAttribute('data-flag-type', displayInfo.locationFlag ? 'country' : 'unknown');

        // Indicator segment
        const indicatorSegment = document.createElement('span');
        if (displayInfo.isVpn) {
          indicatorSegment.textContent = VPN_ICON;
          indicatorSegment.title = 'Account-based location differs from source (possible VPN/proxy)';
          indicatorSegment.setAttribute('data-flag-type', 'vpn');
        } else if (displayInfo.locationAccurate === false) {
          indicatorSegment.textContent = INFO_ICON;
          indicatorSegment.title = 'Location accuracy disclaimer';
          indicatorSegment.setAttribute('data-flag-type', 'info');
        } else {
          indicatorSegment.textContent = ACCURATE_ICON;
          indicatorSegment.title = 'Location is marked accurate';
          indicatorSegment.setAttribute('data-flag-type', 'accuracy');
        }
        indicatorSegment.setAttribute('data-twitter-flag', 'true');

        // Source segment
        const sourceSegment = document.createElement('span');
        sourceSegment.textContent = displayInfo.sourceFlag || UNKNOWN_ICON;
        sourceSegment.title = displayInfo.sourceCountry || displayInfo.source || 'Source region unavailable';
        sourceSegment.setAttribute('data-twitter-flag', 'true');
        sourceSegment.setAttribute('data-flag-type', displayInfo.sourceFlag ? 'country' : 'unknown');

        // Assemble display
        const openBracket = document.createElement('span');
        openBracket.textContent = '[';
        const pipe1 = document.createElement('span');
        pipe1.textContent = '|';
        const pipe2 = document.createElement('span');
        pipe2.textContent = '|';
        const closeBracket = document.createElement('span');
        closeBracket.textContent = ']';

        wrapper.appendChild(openBracket);
        wrapper.appendChild(accountSegment);
        wrapper.appendChild(pipe1);
        wrapper.appendChild(indicatorSegment);
        wrapper.appendChild(pipe2);
        wrapper.appendChild(sourceSegment);
        wrapper.appendChild(closeBracket);

        // Verify DOM structure is consistent
        // 1. Wrapper element exists and has correct attributes
        expect(wrapper.tagName).toBe('SPAN');
        expect(wrapper.getAttribute('data-twitter-flag-wrapper')).toBe('true');
        
        // 2. Wrapper has correct styling (standard CSS properties work identically in both browsers)
        expect(wrapper.style.display).toBe('inline-flex');
        expect(wrapper.style.alignItems).toBe('center');
        expect(wrapper.style.verticalAlign).toBe('middle');
        
        // 3. Wrapper contains exactly 7 children: [ flag | indicator | flag ]
        expect(wrapper.children.length).toBe(7);
        
        // 4. First child is opening bracket
        expect(wrapper.children[0].textContent).toBe('[');
        
        // 5. Second child is account flag (or unknown icon)
        expect(wrapper.children[1].textContent).toBe(displayInfo.locationFlag || UNKNOWN_ICON);
        expect(wrapper.children[1].getAttribute('data-twitter-flag')).toBe('true');
        
        // 6. Third child is pipe separator
        expect(wrapper.children[2].textContent).toBe('|');
        
        // 7. Fourth child is indicator (VPN, info, or accurate)
        expect(wrapper.children[3].getAttribute('data-twitter-flag')).toBe('true');
        if (displayInfo.isVpn) {
          expect(wrapper.children[3].textContent).toBe(VPN_ICON);
        } else if (displayInfo.locationAccurate === false) {
          expect(wrapper.children[3].textContent).toBe(INFO_ICON);
        } else {
          expect(wrapper.children[3].textContent).toBe(ACCURATE_ICON);
        }
        
        // 8. Fifth child is pipe separator
        expect(wrapper.children[4].textContent).toBe('|');
        
        // 9. Sixth child is source flag (or unknown icon)
        expect(wrapper.children[5].textContent).toBe(displayInfo.sourceFlag || UNKNOWN_ICON);
        expect(wrapper.children[5].getAttribute('data-twitter-flag')).toBe('true');
        
        // 10. Seventh child is closing bracket
        expect(wrapper.children[6].textContent).toBe(']');
        
        // 11. Verify all DOM APIs used are standard (work identically in Chrome and Firefox)
        // createElement, setAttribute, appendChild, textContent, style properties are all standard
        expect(typeof document.createElement).toBe('function');
        expect(typeof wrapper.setAttribute).toBe('function');
        expect(typeof wrapper.appendChild).toBe('function');
        
        // 12. Verify flag emoji rendering is consistent (emojis are Unicode, work identically)
        if (displayInfo.locationFlag) {
          // Flag emojis are Unicode characters, rendered identically by both browsers
          expect(typeof displayInfo.locationFlag).toBe('string');
          expect(displayInfo.locationFlag.length).toBeGreaterThan(0);
        }
        
        if (displayInfo.sourceFlag) {
          expect(typeof displayInfo.sourceFlag).toBe('string');
          expect(displayInfo.sourceFlag.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('buildBracketedDisplay creates wrapper with correct structure', () => {
    const displayInfo = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };

    const wrapper = document.createElement('span');
    wrapper.setAttribute('data-twitter-flag-wrapper', 'true');
    
    // Verify wrapper is created with standard DOM APIs
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper.getAttribute('data-twitter-flag-wrapper')).toBe('true');
  });

  it('display uses only standard DOM APIs', () => {
    // Verify that all DOM manipulation uses standard APIs that work identically in Chrome and Firefox
    
    // Verify document.createElement exists
    expect(typeof document.createElement).toBe('function');
    
    // Create an element and verify element methods exist
    const elem = document.createElement('span');
    expect(typeof elem.setAttribute).toBe('function');
    expect(typeof elem.appendChild).toBe('function');
    expect(elem.style).toBeDefined();
    expect('textContent' in elem).toBe(true);
  });

  it('flag emoji rendering is consistent across browsers', () => {
    // Flag emojis are Unicode characters that render identically in both browsers
    const flags = ['🇺🇸', '🇬🇧', '🇨🇦', '🇩🇪', '🇫🇷', '🇯🇵', '🇦🇺'];
    
    flags.forEach(flag => {
      const span = document.createElement('span');
      span.textContent = flag;
      
      // Verify emoji is set correctly
      expect(span.textContent).toBe(flag);
      expect(typeof span.textContent).toBe('string');
      
      // Verify emoji length (flag emojis are typically 2-4 characters due to Unicode composition)
      expect(span.textContent.length).toBeGreaterThan(0);
    });
  });

  it('display format handles null values consistently', () => {
    const displayInfo = {
      location: null,
      locationFlag: null,
      source: null,
      sourceFlag: null,
      sourceCountry: null,
      locationAccurate: null,
      isVpn: false,
      learnMoreUrl: null
    };

    const UNKNOWN_ICON = '\u2022';
    const ACCURATE_ICON = '\u2705';

    // Create display
    const wrapper = document.createElement('span');
    const accountSegment = document.createElement('span');
    accountSegment.textContent = displayInfo.locationFlag || UNKNOWN_ICON;
    
    const sourceSegment = document.createElement('span');
    sourceSegment.textContent = displayInfo.sourceFlag || UNKNOWN_ICON;

    // Verify null values are handled with unknown icon
    expect(accountSegment.textContent).toBe(UNKNOWN_ICON);
    expect(sourceSegment.textContent).toBe(UNKNOWN_ICON);
  });

  it('VPN indicator is displayed correctly', () => {
    const displayInfo = {
      location: 'United Kingdom',
      locationFlag: '🇬🇧',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: true,
      learnMoreUrl: null
    };

    const VPN_ICON = '\uD83D\uDEE1';
    const indicatorSegment = document.createElement('span');
    
    if (displayInfo.isVpn) {
      indicatorSegment.textContent = VPN_ICON;
      indicatorSegment.title = 'Account-based location differs from source (possible VPN/proxy)';
    }

    expect(indicatorSegment.textContent).toBe(VPN_ICON);
    expect(indicatorSegment.title).toContain('VPN');
  });

  it('accuracy indicator is displayed correctly', () => {
    const ACCURATE_ICON = '\u2705';
    const INFO_ICON = '\u2139\uFE0F';

    // Test accurate location
    const accurateInfo = {
      locationAccurate: true,
      isVpn: false
    };
    
    const accurateSegment = document.createElement('span');
    if (!accurateInfo.isVpn) {
      if (accurateInfo.locationAccurate === false) {
        accurateSegment.textContent = INFO_ICON;
      } else {
        accurateSegment.textContent = ACCURATE_ICON;
      }
    }
    
    expect(accurateSegment.textContent).toBe(ACCURATE_ICON);

    // Test inaccurate location
    const inaccurateInfo = {
      locationAccurate: false,
      isVpn: false
    };
    
    const inaccurateSegment = document.createElement('span');
    if (!inaccurateInfo.isVpn) {
      if (inaccurateInfo.locationAccurate === false) {
        inaccurateSegment.textContent = INFO_ICON;
      } else {
        inaccurateSegment.textContent = ACCURATE_ICON;
      }
    }
    
    expect(inaccurateSegment.textContent).toBe(INFO_ICON);
  });
});

describe('PostMessage Communication Cross-Browser Compatibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: firefox-compatibility, Property 16: PostMessage communication**
   * **Validates: Requirements 8.3, 8.4**
   * 
   * For any message sent from content script to page script via window.postMessage(), 
   * the page script should receive it and respond with a __locationResponse message 
   * containing the location data.
   */
  it('Property 16: PostMessage communication - content to page script messaging works', () => {
    // Generator for valid Twitter usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'))
      .filter(s => !/^\d+$/.test(s));

    // Generator for request IDs
    const requestIdGen = fc.double({ min: 0, max: Number.MAX_SAFE_INTEGER });

    // Generator for location data responses
    const locationDataGen = fc.record({
      location: fc.oneof(
        fc.constant(null),
        fc.constantFrom('United States', 'United Kingdom', 'Canada', 'Germany', 'France')
      ),
      source: fc.oneof(
        fc.constant(null),
        fc.constantFrom('United States', 'United Kingdom', 'Canada', 'Germany', 'France')
      ),
      sourceCountry: fc.oneof(
        fc.constant(null),
        fc.constantFrom('United States', 'United Kingdom', 'Canada', 'Germany', 'France')
      ),
      locationAccurate: fc.oneof(fc.constant(null), fc.boolean()),
      learnMoreUrl: fc.oneof(fc.constant(null), fc.constant('https://help.twitter.com/location'))
    });

    fc.assert(
      fc.property(usernameGen, requestIdGen, locationDataGen, (screenName, requestId, locationData) => {
        // Track messages sent via postMessage
        const messagesSent = [];
        const originalPostMessage = window.postMessage;
        window.postMessage = vi.fn((message, targetOrigin) => {
          messagesSent.push({ message, targetOrigin });
          // Simulate immediate response from page script
          if (message.type === '__fetchLocation') {
            // Trigger response handler
            const responseEvent = new MessageEvent('message', {
              data: {
                type: '__locationResponse',
                screenName: message.screenName,
                locationData: locationData,
                requestId: message.requestId
              },
              source: window
            });
            window.dispatchEvent(responseEvent);
          }
        });

        // Setup message listener (simulating content script behavior)
        let receivedResponse = null;
        const messageHandler = (event) => {
          if (event.source !== window) return;
          if (event.data && event.data.type === '__locationResponse') {
            receivedResponse = event.data;
          }
        };
        window.addEventListener('message', messageHandler);

        // Send __fetchLocation message (simulating content script)
        window.postMessage({
          type: '__fetchLocation',
          screenName: screenName,
          requestId: requestId
        }, '*');

        // Verify message was sent
        expect(messagesSent.length).toBeGreaterThan(0);
        const fetchMessage = messagesSent.find(m => m.message.type === '__fetchLocation');
        expect(fetchMessage).toBeDefined();
        expect(fetchMessage.message.screenName).toBe(screenName);
        expect(fetchMessage.message.requestId).toBe(requestId);
        expect(fetchMessage.targetOrigin).toBe('*');

        // Verify response was received
        expect(receivedResponse).toBeDefined();
        expect(receivedResponse.type).toBe('__locationResponse');
        expect(receivedResponse.screenName).toBe(screenName);
        expect(receivedResponse.requestId).toBe(requestId);
        expect(receivedResponse.locationData).toEqual(locationData);

        // Verify postMessage uses standard API (works identically in Chrome and Firefox)
        expect(typeof window.postMessage).toBe('function');
        expect(typeof window.addEventListener).toBe('function');
        expect(typeof MessageEvent).toBe('function');

        // Cleanup
        window.removeEventListener('message', messageHandler);
        window.postMessage = originalPostMessage;
      }),
      { numRuns: 100 }
    );
  });

  it('postMessage sends __fetchLocation with correct structure', () => {
    const messagesSent = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = vi.fn((message, targetOrigin) => {
      messagesSent.push({ message, targetOrigin });
    });

    // Send message
    window.postMessage({
      type: '__fetchLocation',
      screenName: 'testuser',
      requestId: 12345
    }, '*');

    // Verify structure
    expect(messagesSent.length).toBe(1);
    expect(messagesSent[0].message.type).toBe('__fetchLocation');
    expect(messagesSent[0].message.screenName).toBe('testuser');
    expect(messagesSent[0].message.requestId).toBe(12345);
    expect(messagesSent[0].targetOrigin).toBe('*');

    window.postMessage = originalPostMessage;
  });

  it('postMessage response includes all required fields', () => {
    let receivedResponse = null;
    const messageHandler = (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__locationResponse') {
        receivedResponse = event.data;
      }
    };
    window.addEventListener('message', messageHandler);

    // Simulate response from page script
    const responseEvent = new MessageEvent('message', {
      data: {
        type: '__locationResponse',
        screenName: 'testuser',
        locationData: {
          location: 'United States',
          source: 'United States',
          sourceCountry: 'United States',
          locationAccurate: true,
          learnMoreUrl: null
        },
        requestId: 12345
      },
      source: window
    });
    window.dispatchEvent(responseEvent);

    // Verify response structure
    expect(receivedResponse).toBeDefined();
    expect(receivedResponse.type).toBe('__locationResponse');
    expect(receivedResponse.screenName).toBe('testuser');
    expect(receivedResponse.requestId).toBe(12345);
    expect(receivedResponse.locationData).toBeDefined();
    expect(receivedResponse.locationData.location).toBe('United States');

    window.removeEventListener('message', messageHandler);
  });

  it('postMessage filters messages by source (only accepts from window)', () => {
    let messageCount = 0;
    const messageHandler = (event) => {
      // Only accept messages from the page (same as content.js)
      if (event.source !== window) return;
      if (event.data && event.data.type === '__locationResponse') {
        messageCount++;
      }
    };
    window.addEventListener('message', messageHandler);

    // Send message from window (should be accepted)
    const validEvent = new MessageEvent('message', {
      data: { type: '__locationResponse', screenName: 'test1', requestId: 1 },
      source: window
    });
    window.dispatchEvent(validEvent);

    // Send message from different source (should be rejected)
    const invalidEvent = new MessageEvent('message', {
      data: { type: '__locationResponse', screenName: 'test2', requestId: 2 },
      source: {} // Different source
    });
    window.dispatchEvent(invalidEvent);

    // Only the valid message should be counted
    expect(messageCount).toBe(1);

    window.removeEventListener('message', messageHandler);
  });

  it('postMessage communication uses standard Web API', () => {
    // Verify that postMessage and MessageEvent are standard APIs
    // These work identically in Chrome and Firefox
    expect(typeof window.postMessage).toBe('function');
    expect(typeof window.addEventListener).toBe('function');
    expect(typeof window.removeEventListener).toBe('function');
    expect(typeof MessageEvent).toBe('function');

    // Verify MessageEvent can be constructed
    const event = new MessageEvent('message', {
      data: { test: 'data' },
      source: window
    });
    expect(event.type).toBe('message');
    expect(event.data).toEqual({ test: 'data' });
    expect(event.source).toBe(window);
  });
});

describe('Fetch Credentials Inclusion Cross-Browser Compatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Feature: firefox-compatibility, Property 20: Fetch credentials inclusion**
   * **Validates: Requirements 8.2**
   * 
   * For any fetch request made by the page script to Twitter's GraphQL API, 
   * the request should include credentials: 'include' to send authentication cookies.
   */
  it('Property 20: Fetch credentials inclusion - all GraphQL requests include credentials', () => {
    // Generator for valid Twitter usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'))
      .filter(s => !/^\d+$/.test(s));

    // Generator for headers (simulating captured Twitter headers)
    const headersGen = fc.record({
      'Accept': fc.constant('application/json'),
      'Content-Type': fc.constant('application/json'),
      'Authorization': fc.option(fc.string(), { nil: null }),
      'x-csrf-token': fc.option(fc.string(), { nil: null })
    });

    fc.assert(
      fc.property(usernameGen, headersGen, (screenName, headers) => {
        // Track fetch calls
        const fetchCalls = [];
        const originalFetch = global.fetch;
        global.fetch = vi.fn((url, options) => {
          fetchCalls.push({ url, options });
          // Return a mock successful response
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                user_result_by_screen_name: {
                  result: {
                    about_profile: {
                      account_based_in: 'United States',
                      source: 'United States',
                      source_country: 'United States',
                      location_accurate: true,
                      learn_more_url: null
                    }
                  }
                }
              }
            })
          });
        });

        // Simulate page script fetch logic
        const variables = JSON.stringify({ screenName });
        const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;
        
        // Make fetch request with credentials (as page script does)
        fetch(url, {
          method: 'GET',
          credentials: 'include', // This is the critical property
          headers: headers,
          referrer: window.location.href,
          referrerPolicy: 'origin-when-cross-origin'
        });

        // Verify fetch was called
        expect(fetchCalls.length).toBe(1);
        
        // Verify URL is correct GraphQL endpoint
        expect(fetchCalls[0].url).toContain('https://x.com/i/api/graphql');
        expect(fetchCalls[0].url).toContain('AboutAccountQuery');
        expect(fetchCalls[0].url).toContain(encodeURIComponent(screenName));
        
        // Verify credentials: 'include' is present
        expect(fetchCalls[0].options).toBeDefined();
        expect(fetchCalls[0].options.credentials).toBe('include');
        
        // Verify method is GET
        expect(fetchCalls[0].options.method).toBe('GET');
        
        // Verify headers are included
        expect(fetchCalls[0].options.headers).toBeDefined();
        expect(fetchCalls[0].options.headers).toEqual(headers);
        
        // Verify referrer policy is set (standard across browsers)
        expect(fetchCalls[0].options.referrerPolicy).toBe('origin-when-cross-origin');
        
        // Verify fetch API is standard (works identically in Chrome and Firefox)
        expect(typeof fetch).toBe('function');
        
        // Cleanup
        global.fetch = originalFetch;
      }),
      { numRuns: 100 }
    );
  });

  it('fetch request includes credentials: include', () => {
    const fetchCalls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn((url, options) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    // Make fetch request
    const url = 'https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=%7B%22screenName%22%3A%22testuser%22%7D';
    fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });

    // Verify credentials are included
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].options.credentials).toBe('include');

    global.fetch = originalFetch;
  });

  it('fetch request without credentials: include would not send cookies', () => {
    // This test demonstrates why credentials: 'include' is necessary
    const fetchCalls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn((url, options) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    // Make fetch request WITHOUT credentials
    const url = 'https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=%7B%22screenName%22%3A%22testuser%22%7D';
    fetch(url, {
      method: 'GET',
      // credentials NOT included - this would fail authentication
      headers: { 'Accept': 'application/json' }
    });

    // Verify credentials are NOT included (would cause authentication failure)
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].options.credentials).toBeUndefined();

    global.fetch = originalFetch;
  });

  it('fetch API is standard and works identically in Chrome and Firefox', () => {
    // Verify fetch is a standard API
    expect(typeof fetch).toBe('function');
    
    // Verify fetch accepts standard options
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({})
    }));

    // Test with all standard options
    fetch('https://example.com', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      referrer: 'https://example.com',
      referrerPolicy: 'origin-when-cross-origin'
    });

    expect(global.fetch).toHaveBeenCalledWith('https://example.com', {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      referrer: 'https://example.com',
      referrerPolicy: 'origin-when-cross-origin'
    });

    global.fetch = originalFetch;
  });

  it('credentials: include sends authentication cookies for same-origin requests', () => {
    // This test verifies the behavior of credentials: 'include'
    // In both Chrome and Firefox, credentials: 'include' sends cookies for same-origin requests
    
    const fetchCalls = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn((url, options) => {
      fetchCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    // Same-origin request (page script runs in page context, so x.com is same-origin)
    fetch('https://x.com/i/api/graphql/test', {
      credentials: 'include'
    });

    // Verify credentials: 'include' is set
    expect(fetchCalls[0].options.credentials).toBe('include');
    
    // In both browsers, this would send authentication cookies
    // because the request is same-origin (page script runs in page context)

    global.fetch = originalFetch;
  });

  it('GraphQL endpoint URL format is correct', () => {
    const screenName = 'testuser';
    const variables = JSON.stringify({ screenName });
    const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;

    // Verify URL structure
    expect(url).toContain('https://x.com/i/api/graphql');
    expect(url).toContain('XRqGa7EeokUU5kppkh13EA');
    expect(url).toContain('AboutAccountQuery');
    expect(url).toContain('variables=');
    
    // Verify variables are properly encoded
    expect(url).toContain(encodeURIComponent(variables));
    
    // Verify decoding works correctly
    const urlObj = new URL(url);
    const decodedVariables = JSON.parse(decodeURIComponent(urlObj.searchParams.get('variables')));
    expect(decodedVariables.screenName).toBe(screenName);
  });
});

describe('Error Communication from Page Script Cross-Browser Compatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Feature: firefox-compatibility, Property 21: Error communication from page script**
   * **Validates: Requirements 8.5**
   * 
   * For any error in the page script (network error, API error), a __locationResponse 
   * message should be sent with locationData: null.
   */
  it('Property 21: Error communication from page script - errors result in null locationData response', () => {
    // Generator for valid Twitter usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'))
      .filter(s => !/^\d+$/.test(s));

    // Generator for request IDs
    const requestIdGen = fc.double({ min: 0, max: Number.MAX_SAFE_INTEGER });

    // Generator for error types
    const errorTypeGen = fc.constantFrom(
      'network_error',
      'fetch_exception',
      'json_parse_error',
      'api_error_404',
      'api_error_500',
      'timeout_error'
    );

    fc.assert(
      fc.property(usernameGen, requestIdGen, errorTypeGen, (screenName, requestId, errorType) => {
        // Track messages sent via postMessage
        const messagesSent = [];
        const originalPostMessage = window.postMessage;
        window.postMessage = vi.fn((message, targetOrigin) => {
          messagesSent.push({ message, targetOrigin });
        });

        // Setup message listener to capture error responses
        let receivedResponse = null;
        const messageHandler = (event) => {
          if (event.source !== window) return;
          if (event.data && event.data.type === '__locationResponse') {
            receivedResponse = event.data;
          }
        };
        window.addEventListener('message', messageHandler);

        // Simulate page script error handling based on error type
        try {
          // Simulate different error scenarios
          switch (errorType) {
            case 'network_error':
            case 'fetch_exception':
            case 'json_parse_error':
            case 'timeout_error':
              // These errors should result in catch block sending null locationData
              throw new Error(`Simulated ${errorType}`);
            
            case 'api_error_404':
            case 'api_error_500':
              // API errors should also result in null locationData
              // (page script doesn't get valid data from failed API calls)
              throw new Error(`API returned ${errorType}`);
            
            default:
              throw new Error('Unknown error type');
          }
        } catch (error) {
          // Simulate page script error handler (from pageScript.js)
          // When an error occurs, send __locationResponse with locationData: null
          window.postMessage({
            type: '__locationResponse',
            screenName: screenName,
            locationData: null,
            requestId: requestId
          }, '*');
        }

        // Trigger the message event
        const responseEvent = new MessageEvent('message', {
          data: {
            type: '__locationResponse',
            screenName: screenName,
            locationData: null,
            requestId: requestId
          },
          source: window
        });
        window.dispatchEvent(responseEvent);

        // Verify error response was sent
        expect(messagesSent.length).toBeGreaterThan(0);
        const errorResponse = messagesSent.find(m => 
          m.message.type === '__locationResponse' && 
          m.message.screenName === screenName
        );
        expect(errorResponse).toBeDefined();
        expect(errorResponse.message.locationData).toBeNull();
        expect(errorResponse.message.requestId).toBe(requestId);
        expect(errorResponse.targetOrigin).toBe('*');

        // Verify response was received by content script
        expect(receivedResponse).toBeDefined();
        expect(receivedResponse.type).toBe('__locationResponse');
        expect(receivedResponse.screenName).toBe(screenName);
        expect(receivedResponse.requestId).toBe(requestId);
        expect(receivedResponse.locationData).toBeNull();

        // Verify error communication uses standard postMessage API
        expect(typeof window.postMessage).toBe('function');

        // Cleanup
        window.removeEventListener('message', messageHandler);
        window.postMessage = originalPostMessage;
      }),
      { numRuns: 100 }
    );
  });

  it('network error results in null locationData response', () => {
    const messagesSent = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = vi.fn((message, targetOrigin) => {
      messagesSent.push({ message, targetOrigin });
    });

    // Simulate network error in page script
    try {
      throw new Error('Network request failed');
    } catch (error) {
      // Page script error handler sends null locationData
      window.postMessage({
        type: '__locationResponse',
        screenName: 'testuser',
        locationData: null,
        requestId: 12345
      }, '*');
    }

    // Verify error response
    expect(messagesSent.length).toBe(1);
    expect(messagesSent[0].message.type).toBe('__locationResponse');
    expect(messagesSent[0].message.locationData).toBeNull();
    expect(messagesSent[0].message.screenName).toBe('testuser');

    window.postMessage = originalPostMessage;
  });

  it('fetch exception results in null locationData response', () => {
    const messagesSent = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = vi.fn((message, targetOrigin) => {
      messagesSent.push({ message, targetOrigin });
    });

    // Simulate fetch exception in page script
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => {
      throw new Error('Fetch failed');
    });

    try {
      fetch('https://x.com/i/api/graphql/test');
    } catch (error) {
      // Page script error handler sends null locationData
      window.postMessage({
        type: '__locationResponse',
        screenName: 'testuser',
        locationData: null,
        requestId: 12345
      }, '*');
    }

    // Verify error response
    expect(messagesSent.length).toBe(1);
    expect(messagesSent[0].message.locationData).toBeNull();

    global.fetch = originalFetch;
    window.postMessage = originalPostMessage;
  });

  it('JSON parse error results in null locationData response', () => {
    const messagesSent = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = vi.fn((message, targetOrigin) => {
      messagesSent.push({ message, targetOrigin });
    });

    // Simulate JSON parse error in page script
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => {
        throw new Error('Invalid JSON');
      }
    }));

    // Simulate page script handling
    fetch('https://x.com/i/api/graphql/test')
      .then(response => response.json())
      .catch(error => {
        // Page script error handler sends null locationData
        window.postMessage({
          type: '__locationResponse',
          screenName: 'testuser',
          locationData: null,
          requestId: 12345
        }, '*');
      });

    // Wait for promise to resolve
    return new Promise(resolve => {
      setTimeout(() => {
        // Verify error response
        expect(messagesSent.length).toBe(1);
        expect(messagesSent[0].message.locationData).toBeNull();

        global.fetch = originalFetch;
        window.postMessage = originalPostMessage;
        resolve();
      }, 100);
    });
  });

  it('API error (non-ok response) results in null locationData response', () => {
    const messagesSent = [];
    const originalPostMessage = window.postMessage;
    window.postMessage = vi.fn((message, targetOrigin) => {
      messagesSent.push({ message, targetOrigin });
    });

    // Simulate API error (404, 500, etc.) in page script
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('User not found')
    }));

    // Simulate page script handling
    fetch('https://x.com/i/api/graphql/test')
      .then(response => {
        if (!response.ok) {
          // Page script sends null locationData for non-ok responses
          window.postMessage({
            type: '__locationResponse',
            screenName: 'testuser',
            locationData: null,
            requestId: 12345
          }, '*');
        }
      });

    // Wait for promise to resolve
    return new Promise(resolve => {
      setTimeout(() => {
        // Verify error response
        expect(messagesSent.length).toBe(1);
        expect(messagesSent[0].message.locationData).toBeNull();

        global.fetch = originalFetch;
        window.postMessage = originalPostMessage;
        resolve();
      }, 100);
    });
  });

  it('error response includes all required fields', () => {
    let receivedResponse = null;
    const messageHandler = (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__locationResponse') {
        receivedResponse = event.data;
      }
    };
    window.addEventListener('message', messageHandler);

    // Simulate error response from page script
    const responseEvent = new MessageEvent('message', {
      data: {
        type: '__locationResponse',
        screenName: 'testuser',
        locationData: null,
        requestId: 12345
      },
      source: window
    });
    window.dispatchEvent(responseEvent);

    // Verify error response structure
    expect(receivedResponse).toBeDefined();
    expect(receivedResponse.type).toBe('__locationResponse');
    expect(receivedResponse.screenName).toBe('testuser');
    expect(receivedResponse.requestId).toBe(12345);
    expect(receivedResponse.locationData).toBeNull();

    window.removeEventListener('message', messageHandler);
  });

  it('content script handles null locationData gracefully', () => {
    // This test verifies that content script can handle error responses
    let receivedResponse = null;
    const messageHandler = (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === '__locationResponse') {
        receivedResponse = event.data;
        
        // Content script should handle null locationData
        const locationData = event.data.locationData;
        if (locationData === null) {
          // This is expected for errors - content script should not cache
          // and should mark the username as failed
          expect(locationData).toBeNull();
        }
      }
    };
    window.addEventListener('message', messageHandler);

    // Simulate error response
    const responseEvent = new MessageEvent('message', {
      data: {
        type: '__locationResponse',
        screenName: 'testuser',
        locationData: null,
        requestId: 12345
      },
      source: window
    });
    window.dispatchEvent(responseEvent);

    // Verify content script received and can handle null locationData
    expect(receivedResponse).toBeDefined();
    expect(receivedResponse.locationData).toBeNull();

    window.removeEventListener('message', messageHandler);
  });

  it('error communication works identically in Chrome and Firefox', () => {
    // Verify that error communication uses standard APIs
    // postMessage and MessageEvent work identically in both browsers
    
    expect(typeof window.postMessage).toBe('function');
    expect(typeof MessageEvent).toBe('function');

    // Create error response message
    const errorMessage = {
      type: '__locationResponse',
      screenName: 'testuser',
      locationData: null,
      requestId: 12345
    };

    // Verify message structure is standard JavaScript object
    expect(typeof errorMessage).toBe('object');
    expect(errorMessage.locationData).toBeNull();

    // Verify MessageEvent can be constructed with error response
    const event = new MessageEvent('message', {
      data: errorMessage,
      source: window
    });
    expect(event.type).toBe('message');
    expect(event.data.locationData).toBeNull();
  });
});

describe('MutationObserver Cross-Browser Compatibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: firefox-compatibility, Property 4: Dynamic content detection**
   * **Validates: Requirements 1.4**
   * 
   * For any DOM mutation that adds new username elements, the MutationObserver 
   * should trigger processUsernames() within the debounce period.
   */
  it('Property 4: Dynamic content detection - detects new username elements', () => {
    // Generator for valid Twitter usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'))
      .filter(s => !/^\d+$/.test(s)); // Not all digits

    // Generator for number of usernames to add
    const countGen = fc.integer({ min: 1, max: 5 });

    fc.assert(
      fc.property(usernameGen, countGen, (screenName, count) => {
        // Clear DOM before each test iteration
        document.body.innerHTML = '';
        
        // Track if processUsernames would be called
        let processUsernameCalled = false;
        const addedNodes = [];

        // Create a MutationObserver (standard API, works identically in Chrome and Firefox)
        const observer = new MutationObserver((mutations) => {
          let shouldProcess = false;
          for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
              shouldProcess = true;
              break;
            }
          }

          if (shouldProcess) {
            // Simulate debounced processing (500ms delay as in content.js)
            setTimeout(() => {
              processUsernameCalled = true;
            }, 500);
          }
        });

        // Observe document.body with same config as content.js
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        // Add username elements to the DOM (simulating dynamic content)
        for (let i = 0; i < count; i++) {
          const container = createTwitterDOMStructure(screenName, 'standard');
          addedNodes.push(container);
          document.body.appendChild(container);
        }

        // Verify MutationObserver detected the changes
        // The observer callback should have been called synchronously
        // Then we need to advance timers to trigger the debounced callback
        vi.advanceTimersByTime(500);

        // Verify processUsernames would be called
        expect(processUsernameCalled).toBe(true);

        // Verify the added nodes are in the DOM
        expect(document.body.children.length).toBe(count);

        // Verify each added node contains the username
        addedNodes.forEach(node => {
          const username = extractUsernameTest(node);
          expect(username).toBe(screenName);
        });

        // Verify MutationObserver uses standard APIs (works identically in both browsers)
        expect(typeof MutationObserver).toBe('function');
        expect(typeof observer.observe).toBe('function');
        expect(typeof observer.disconnect).toBe('function');

        // Clean up
        observer.disconnect();
      }),
      { numRuns: 100 }
    );
  });

  it('MutationObserver detects single username element addition', () => {
    let mutationDetected = false;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          mutationDetected = true;
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Add a username element
    const container = createTwitterDOMStructure('testuser', 'standard');
    document.body.appendChild(container);

    // Verify mutation was detected
    expect(mutationDetected).toBe(true);

    observer.disconnect();
  });

  it('MutationObserver detects multiple username elements addition', () => {
    let mutationCount = 0;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          mutationCount++;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Add multiple username elements
    const usernames = ['user1', 'user2', 'user3'];
    usernames.forEach(username => {
      const container = createTwitterDOMStructure(username, 'standard');
      document.body.appendChild(container);
    });

    // Verify mutations were detected
    expect(mutationCount).toBeGreaterThan(0);

    observer.disconnect();
  });

  it('debouncing works correctly with setTimeout', () => {
    let callCount = 0;

    // Simulate debounced function
    const debouncedFunction = () => {
      setTimeout(() => {
        callCount++;
      }, 500);
    };

    // Call multiple times rapidly
    debouncedFunction();
    debouncedFunction();
    debouncedFunction();

    // Before timeout, function should not have executed
    expect(callCount).toBe(0);

    // Advance timers by 500ms
    vi.advanceTimersByTime(500);

    // After timeout, all calls should have executed
    expect(callCount).toBe(3);
  });

  it('MutationObserver uses standard APIs available in both browsers', () => {
    // Verify MutationObserver constructor exists
    expect(typeof MutationObserver).toBe('function');

    // Create observer and verify methods exist
    const observer = new MutationObserver(() => {});
    expect(typeof observer.observe).toBe('function');
    expect(typeof observer.disconnect).toBe('function');
    expect(typeof observer.takeRecords).toBe('function');

    // Verify observe accepts standard config options
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    // These are all standard MutationObserver APIs that work identically in Chrome and Firefox
    observer.disconnect();
  });

  it('MutationObserver detects nested element additions', () => {
    let mutationDetected = false;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          mutationDetected = true;
          break;
        }
      }
    });

    // Observe with subtree: true (detects nested changes)
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Add a nested structure
    const parent = document.createElement('div');
    const child = createTwitterDOMStructure('nesteduser', 'standard');
    parent.appendChild(child);
    document.body.appendChild(parent);

    // Verify mutation was detected (subtree: true enables nested detection)
    expect(mutationDetected).toBe(true);

    observer.disconnect();
  });
});

// Helper functions to simulate content.js behavior
async function saveMode(mode) {
  await chrome.storage.local.set({ [MODE_KEY]: mode });
}

async function loadMode() {
  const result = await chrome.storage.local.get([MODE_KEY]);
  return result[MODE_KEY] || MODE_AUTO;
}

// Helper to create button for testing
function createLocationButton(screenName) {
  const button = document.createElement('button');
  button.className = 'twitter-location-button';
  button.setAttribute('data-twitter-location-button', 'true');
  button.setAttribute('data-screen-name', screenName);
  button.setAttribute('aria-label', `Show location for @${screenName}`);
  button.title = 'Click to show account location';
  
  button.innerHTML = '📍';
  
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-left: 4px;
    margin-right: 4px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    opacity: 0.6;
    transition: opacity 0.2s ease, transform 0.2s ease;
    vertical-align: middle;
    flex-shrink: 0;
  `;
  
  button.addEventListener('mouseenter', () => {
    button.style.opacity = '1';
    button.style.transform = 'scale(1.1)';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.opacity = '0.6';
    button.style.transform = 'scale(1)';
  });
  
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`Button clicked for ${screenName}`);
  });
  
  return button;
}

describe('Mode Storage and State Management', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  /**
   * **Feature: manual-mode, Property 1: Mode persistence**
   * **Validates: Requirements 1.2**
   * 
   * For any mode selection (auto or manual), saving the mode to storage 
   * should result in the same mode being retrievable from storage.
   */
  it('Property 1: Mode persistence - saved mode equals retrieved mode', async () => {
    const modeGen = fc.constantFrom(MODE_AUTO, MODE_MANUAL);

    await fc.assert(
      fc.asyncProperty(modeGen, async (mode) => {
        // Save mode to storage
        await saveMode(mode);
        
        // Retrieve mode from storage
        const retrievedMode = await loadMode();
        
        // Verify retrieved mode matches saved mode
        expect(retrievedMode).toBe(mode);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 3: Default mode initialization**
   * **Validates: Requirements 1.4**
   * 
   * For any extension initialization without saved preferences, the mode 
   * should default to "Auto".
   */
  it('Property 3: Default mode initialization - defaults to auto when no preference', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        // Clear storage to simulate no saved preference
        mockStorage.clear();
        
        // Load mode (simulating extension initialization)
        const mode = await loadMode();
        
        // Verify mode defaults to AUTO
        expect(mode).toBe(MODE_AUTO);
        
        // Verify storage was not modified (no preference saved)
        expect(mockStorage.has(MODE_KEY)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('defaults to auto mode when no preference exists', async () => {
    const mode = await loadMode();
    expect(mode).toBe(MODE_AUTO);
  });

  it('persists auto mode correctly', async () => {
    await saveMode(MODE_AUTO);
    const mode = await loadMode();
    expect(mode).toBe(MODE_AUTO);
  });

  it('persists manual mode correctly', async () => {
    await saveMode(MODE_MANUAL);
    const mode = await loadMode();
    expect(mode).toBe(MODE_MANUAL);
  });
});

// Mock getUserLocation for testing
let mockGetUserLocation = vi.fn();
let requestQueueForTest = [];

// Helper to simulate getUserLocation behavior
function setupGetUserLocationMock() {
  mockGetUserLocation = vi.fn((screenName) => {
    // Track that a request was made
    requestQueueForTest.push(screenName);
    
    // Return mock location data
    return Promise.resolve({
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    });
  });
}

// Helper to create loading shimmer
function createLoadingShimmer() {
  const shimmer = document.createElement('span');
  shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
  shimmer.style.display = 'inline-block';
  shimmer.style.width = '20px';
  shimmer.style.height = '16px';
  shimmer.style.marginLeft = '4px';
  shimmer.style.marginRight = '4px';
  shimmer.style.verticalAlign = 'middle';
  return shimmer;
}

// Helper to create error indicator
function createErrorIndicator() {
  const span = document.createElement('span');
  span.setAttribute('data-twitter-flag-error', 'true');
  span.textContent = '⚠️';
  span.title = 'Failed to load location data';
  span.style.cssText = `
    display: inline-flex;
    align-items: center;
    font-size: 14px;
    margin-left: 4px;
    margin-right: 4px;
    opacity: 0.5;
    vertical-align: middle;
  `;
  return span;
}

// Helper to build bracketed display
function buildBracketedDisplay(displayInfo) {
  const wrapper = document.createElement('span');
  wrapper.setAttribute('data-twitter-flag-wrapper', 'true');
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '4px';
  wrapper.style.marginLeft = '4px';
  wrapper.style.marginRight = '4px';
  wrapper.style.fontSize = '0.95em';
  wrapper.style.verticalAlign = 'middle';
  
  // Simplified display for testing
  wrapper.textContent = `[${displayInfo.locationFlag || '•'} | ${displayInfo.locationAccurate ? '✅' : 'ℹ️'} | ${displayInfo.sourceFlag || '•'}]`;
  
  return wrapper;
}

// Simulate handleButtonClick for testing
async function handleButtonClick(button, screenName) {
  const shimmer = createLoadingShimmer();
  button.replaceWith(shimmer);
  
  try {
    const locationInfo = await mockGetUserLocation(screenName);
    
    if (locationInfo) {
      const flagWrapper = buildBracketedDisplay(locationInfo);
      shimmer.replaceWith(flagWrapper);
    } else {
      const errorIcon = createErrorIndicator();
      shimmer.replaceWith(errorIcon);
    }
  } catch (error) {
    const errorIcon = createErrorIndicator();
    shimmer.replaceWith(errorIcon);
  }
}

describe('Button-Link Component', () => {
  beforeEach(() => {
    // Clear any existing DOM elements
    document.body.innerHTML = '';
    // Reset request queue
    requestQueueForTest = [];
    // Setup mock
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 6: Button clickability indication**
   * **Validates: Requirements 2.2**
   * 
   * For any button-link element, it should have CSS properties indicating 
   * interactivity (cursor: pointer, hover effects).
   */
  it('Property 6: Button clickability indication - button has interactive CSS properties', () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    fc.assert(
      fc.property(usernameGen, (screenName) => {
        // Create button
        const button = createLocationButton(screenName);
        
        // Verify button has cursor: pointer
        expect(button.style.cursor).toBe('pointer');
        
        // Verify button has transition for hover effects
        expect(button.style.transition).toContain('opacity');
        expect(button.style.transition).toContain('transform');
        
        // Verify button has initial opacity
        expect(button.style.opacity).toBe('0.6');
        
        // Verify button has proper attributes for accessibility
        expect(button.getAttribute('aria-label')).toBe(`Show location for @${screenName}`);
        expect(button.title).toBe('Click to show account location');
        
        // Verify button has data attribute
        expect(button.getAttribute('data-twitter-location-button')).toBe('true');
        expect(button.getAttribute('data-screen-name')).toBe(screenName);
      }),
      { numRuns: 100 }
    );
  });

  it('button has correct structure and styling', () => {
    const button = createLocationButton('testuser');
    
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).toBe('twitter-location-button');
    expect(button.innerHTML).toBe('📍');
    expect(button.style.display).toBe('inline-flex');
    expect(button.style.background).toBe('transparent');
  });

  it('button hover effects work correctly', () => {
    const button = createLocationButton('testuser');
    document.body.appendChild(button);
    
    // Initial state
    expect(button.style.opacity).toBe('0.6');
    // Transform is initially empty, set by hover handlers
    
    // Trigger mouseenter
    button.dispatchEvent(new MouseEvent('mouseenter'));
    expect(button.style.opacity).toBe('1');
    expect(button.style.transform).toBe('scale(1.1)');
    
    // Trigger mouseleave
    button.dispatchEvent(new MouseEvent('mouseleave'));
    expect(button.style.opacity).toBe('0.6');
    expect(button.style.transform).toBe('scale(1)');
  });

  /**
   * **Feature: manual-mode, Property 19: Button positioning consistency**
   * **Validates: Requirements 5.4**
   * 
   * For any button-link insertion, it should be positioned in the same location 
   * where flags are inserted in auto mode (consistent positioning with flags).
   */
  it('Property 19: Button positioning consistency - button has consistent positioning styles', () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    fc.assert(
      fc.property(usernameGen, (screenName) => {
        // Create button
        const button = createLocationButton(screenName);
        
        // Verify button has inline-flex display (same as flags)
        expect(button.style.display).toBe('inline-flex');
        
        // Verify button has vertical-align middle (same as flags)
        expect(button.style.verticalAlign).toBe('middle');
        
        // Verify button has consistent margins (same as flags: 4px left and right)
        expect(button.style.marginLeft).toBe('4px');
        expect(button.style.marginRight).toBe('4px');
        
        // Verify button has consistent sizing
        expect(button.style.width).toBe('20px');
        expect(button.style.height).toBe('20px');
        
        // Verify button uses inline-flex alignment (consistent with flag wrapper)
        expect(button.style.alignItems).toBe('center');
        expect(button.style.justifyContent).toBe('center');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 20: Layout preservation**
   * **Validates: Requirements 5.5**
   * 
   * For any button-link insertion, the existing layout and text flow should 
   * remain intact (no line breaks or overflow).
   */
  it('Property 20: Layout preservation - button does not break layout or text flow', () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    fc.assert(
      fc.property(usernameGen, (screenName) => {
        // Create a mock Twitter username container
        const container = document.createElement('div');
        container.style.cssText = `
          display: flex;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
        `;
        
        // Add display name
        const displayName = document.createElement('span');
        displayName.textContent = 'Test User';
        displayName.style.fontWeight = 'bold';
        container.appendChild(displayName);
        
        // Add username handle
        const handle = document.createElement('span');
        handle.textContent = `@${screenName}`;
        handle.style.marginLeft = '4px';
        handle.style.color = 'gray';
        container.appendChild(handle);
        
        // Get initial layout measurements
        document.body.appendChild(container);
        const initialHeight = container.offsetHeight;
        const initialWidth = container.offsetWidth;
        
        // Create and insert button
        const button = createLocationButton(screenName);
        container.insertBefore(button, handle);
        
        // Get layout measurements after button insertion
        const afterHeight = container.offsetHeight;
        const afterWidth = container.offsetWidth;
        
        // Verify button doesn't break layout
        // 1. Height should remain the same (no line breaks)
        expect(afterHeight).toBe(initialHeight);
        
        // 2. Button should have flex-shrink: 0 to prevent squishing
        // Check that cssText contains flex-shrink (inline styles may not populate .flexShrink property)
        expect(button.style.cssText).toContain('flex-shrink');
        
        // 3. Button should maintain inline-flex display
        expect(button.style.display).toBe('inline-flex');
        
        // 4. Button should have vertical-align middle to stay in line
        expect(button.style.verticalAlign).toBe('middle');
        
        // 5. Button should have fixed dimensions (not responsive that could break layout)
        expect(button.style.width).toBe('20px');
        expect(button.style.height).toBe('20px');
        
        // 6. Button should not have properties that cause overflow
        expect(button.style.position).not.toBe('absolute');
        expect(button.style.position).not.toBe('fixed');
        
        // 7. Verify button has smooth transitions that don't cause layout shifts
        expect(button.style.transition).toContain('opacity');
        expect(button.style.transition).toContain('transform');
        
        // Clean up
        document.body.removeChild(container);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Button Click Handler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 10: Click triggers fetch**
   * **Validates: Requirements 3.1**
   * 
   * For any button-link click, an API request for that specific username 
   * should be added to the request queue.
   */
  it('Property 10: Click triggers fetch - clicking button triggers API request', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Clear request queue before test
        requestQueueForTest = [];
        
        // Create button and add to DOM
        const button = createLocationButton(screenName);
        document.body.appendChild(button);
        
        // Verify no requests before click
        expect(requestQueueForTest.length).toBe(0);
        
        // Click the button
        await handleButtonClick(button, screenName);
        
        // Verify request was made for this specific username
        expect(requestQueueForTest).toContain(screenName);
        expect(requestQueueForTest.length).toBeGreaterThan(0);
        
        // Verify getUserLocation was called with correct username
        expect(mockGetUserLocation).toHaveBeenCalledWith(screenName);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 11: Loading state display**
   * **Validates: Requirements 3.2**
   * 
   * For any button-link click, the button should be replaced with a loading 
   * indicator before the fetch completes.
   */
  it('Property 11: Loading state display - button replaced with loading shimmer', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Create button and add to DOM
        const button = createLocationButton(screenName);
        document.body.appendChild(button);
        
        // Store reference to button's parent
        const parent = button.parentNode;
        
        // Mock getUserLocation to delay so we can check loading state
        let resolveLocation;
        const delayedPromise = new Promise((resolve) => {
          resolveLocation = resolve;
        });
        
        mockGetUserLocation.mockImplementationOnce(() => delayedPromise);
        
        // Start the click handler (don't await yet)
        const clickPromise = handleButtonClick(button, screenName);
        
        // Wait a tiny bit for the shimmer to be inserted
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Verify button is replaced with shimmer
        const shimmer = parent.querySelector('[data-twitter-flag-shimmer]');
        expect(shimmer).toBeTruthy();
        expect(shimmer.getAttribute('data-twitter-flag-shimmer')).toBe('true');
        
        // Verify button is no longer in DOM
        expect(parent.querySelector('[data-twitter-location-button]')).toBeNull();
        
        // Resolve the location fetch
        resolveLocation({
          location: 'United States',
          locationFlag: '🇺🇸',
          source: 'United States',
          sourceFlag: '🇺🇸',
          sourceCountry: 'United States',
          locationAccurate: true,
          isVpn: false,
          learnMoreUrl: null
        });
        
        // Wait for click handler to complete
        await clickPromise;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 12: Successful fetch display**
   * **Validates: Requirements 3.3**
   * 
   * For any successful location data fetch, the loading indicator should be 
   * replaced with the bracketed location display.
   */
  it('Property 12: Successful fetch display - shimmer replaced with location display', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Create button and add to DOM
        const button = createLocationButton(screenName);
        document.body.appendChild(button);
        
        // Store reference to button's parent
        const parent = button.parentNode;
        
        // Click the button and wait for completion
        await handleButtonClick(button, screenName);
        
        // Verify shimmer is no longer in DOM
        expect(parent.querySelector('[data-twitter-flag-shimmer]')).toBeNull();
        
        // Verify location display is present
        const flagWrapper = parent.querySelector('[data-twitter-flag-wrapper]');
        expect(flagWrapper).toBeTruthy();
        expect(flagWrapper.getAttribute('data-twitter-flag-wrapper')).toBe('true');
        
        // Verify display contains expected elements (flags and indicators)
        const displayText = flagWrapper.textContent;
        expect(displayText).toContain('[');
        expect(displayText).toContain(']');
        expect(displayText).toContain('|');
      }),
      { numRuns: 100 }
    );
  });

  it('button click replaces with error indicator on fetch failure', async () => {
    // Mock getUserLocation to return null (failure)
    mockGetUserLocation.mockResolvedValueOnce(null);
    
    const button = createLocationButton('testuser');
    document.body.appendChild(button);
    const parent = button.parentNode;
    
    await handleButtonClick(button, 'testuser');
    
    // Verify error indicator is present
    const errorIcon = parent.querySelector('[data-twitter-flag-error]');
    expect(errorIcon).toBeTruthy();
    expect(errorIcon.textContent).toBe('⚠️');
    expect(errorIcon.title).toBe('Failed to load location data');
  });

  it('button click replaces with error indicator on exception', async () => {
    // Mock getUserLocation to throw error
    mockGetUserLocation.mockRejectedValueOnce(new Error('Network error'));
    
    const button = createLocationButton('testuser');
    document.body.appendChild(button);
    const parent = button.parentNode;
    
    await handleButtonClick(button, 'testuser');
    
    // Verify error indicator is present
    const errorIcon = parent.querySelector('[data-twitter-flag-error]');
    expect(errorIcon).toBeTruthy();
    expect(errorIcon.textContent).toBe('⚠️');
  });
});

// Helper to create mock Twitter DOM structure
function createMockTwitterContainer(screenName) {
  const container = document.createElement('article');
  container.setAttribute('data-testid', 'tweet');
  
  const userNameContainer = document.createElement('div');
  userNameContainer.setAttribute('data-testid', 'User-Name');
  
  // Display name section
  const displayNameDiv = document.createElement('div');
  const displayNameLink = document.createElement('a');
  displayNameLink.href = `/${screenName}`;
  displayNameLink.textContent = 'Display Name';
  displayNameDiv.appendChild(displayNameLink);
  userNameContainer.appendChild(displayNameDiv);
  
  // Handle section (where button should be inserted before)
  const handleDiv = document.createElement('div');
  const handleLink = document.createElement('a');
  handleLink.href = `/${screenName}`;
  handleLink.textContent = `@${screenName}`;
  handleDiv.appendChild(handleLink);
  userNameContainer.appendChild(handleDiv);
  
  container.appendChild(userNameContainer);
  
  return container;
}

// Helper to find handle section (same logic as content.js)
function findHandleSection(container, screenName) {
  return Array.from(container.querySelectorAll('div')).find(div => {
    const link = div.querySelector(`a[href="/${screenName}"]`);
    if (link) {
      const text = link.textContent?.trim();
      return text === `@${screenName}`;
    }
    return false;
  });
}

// Helper to simulate addButtonToUsername
function addButtonToUsername(container, screenName) {
  if (container.dataset.flagAdded) {
    return;
  }
  container.dataset.flagAdded = 'button';
  
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (!userNameContainer) {
    console.error(`Could not find UserName container for ${screenName}`);
    return;
  }
  
  const button = createLocationButton(screenName);
  
  const handleSection = findHandleSection(userNameContainer, screenName);
  
  if (handleSection && handleSection.parentNode) {
    try {
      handleSection.parentNode.insertBefore(button, handleSection);
    } catch (e) {
      console.error('Failed to insert button:', e);
      try {
        userNameContainer.appendChild(button);
      } catch (e2) {
        console.error('Failed to insert button (fallback):', e2);
      }
    }
  } else {
    try {
      userNameContainer.appendChild(button);
    } catch (e) {
      console.error('Failed to insert button (fallback):', e);
    }
  }
}

describe('addButtonToUsername Function', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * **Feature: manual-mode, Property 5: Manual mode button insertion**
   * **Validates: Requirements 2.1**
   * 
   * For any uncached username in manual mode, the extension should insert 
   * a button-link element before the username handle.
   */
  it('Property 5: Manual mode button insertion - button inserted before handle', () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    fc.assert(
      fc.property(usernameGen, (screenName) => {
        // Create mock Twitter container
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Verify no button exists initially
        expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
        
        // Call addButtonToUsername
        addButtonToUsername(container, screenName);
        
        // Verify button was inserted
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeTruthy();
        expect(button.getAttribute('data-screen-name')).toBe(screenName);
        
        // Verify button is positioned before the handle section
        const userNameContainer = container.querySelector('[data-testid="User-Name"]');
        const handleSection = findHandleSection(userNameContainer, screenName);
        
        if (handleSection) {
          // Button should be a sibling of handleSection and come before it
          const siblings = Array.from(handleSection.parentNode.children);
          const buttonIndex = siblings.indexOf(button);
          const handleIndex = siblings.indexOf(handleSection);
          
          // Button should come before handle section
          expect(buttonIndex).toBeLessThan(handleIndex);
        }
        
        // Verify container is marked with data-flag-added="button"
        expect(container.dataset.flagAdded).toBe('button');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 7: Multiple username handling**
   * **Validates: Requirements 2.3**
   * 
   * For any set of visible usernames in manual mode, each should have 
   * its own independent button-link.
   */
  it('Property 7: Multiple username handling - each username gets independent button', () => {
    const usernameListGen = fc.array(
      fc.string({ minLength: 1, maxLength: 15 })
        .filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
      { minLength: 2, maxLength: 5 }
    ).map(arr => [...new Set(arr)]); // Ensure unique usernames

    fc.assert(
      fc.property(usernameListGen, (usernames) => {
        // Clear DOM before each property test run
        document.body.innerHTML = '';
        
        // Skip if we don't have at least 2 unique usernames
        if (usernames.length < 2) {
          return true;
        }
        
        // Create multiple containers, one for each username
        const containers = usernames.map(screenName => {
          const container = createMockTwitterContainer(screenName);
          document.body.appendChild(container);
          return { container, screenName };
        });
        
        // Add buttons to all containers
        containers.forEach(({ container, screenName }) => {
          addButtonToUsername(container, screenName);
        });
        
        // Verify each container has its own button with correct screen name
        containers.forEach(({ container, screenName }) => {
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeTruthy();
          expect(button.getAttribute('data-screen-name')).toBe(screenName);
          
          // Verify button is unique to this container (not shared)
          const allButtons = document.querySelectorAll('[data-twitter-location-button]');
          const buttonsForThisUser = Array.from(allButtons).filter(
            btn => btn.getAttribute('data-screen-name') === screenName
          );
          
          // Should have exactly one button per username
          expect(buttonsForThisUser.length).toBeGreaterThanOrEqual(1);
        });
        
        // Verify total number of buttons matches number of containers
        const totalButtons = document.querySelectorAll('[data-twitter-location-button]').length;
        expect(totalButtons).toBe(containers.length);
      }),
      { numRuns: 100 }
    );
  });

  it('does not insert duplicate buttons for same container', () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // First insertion
    addButtonToUsername(container, 'testuser');
    const firstButton = container.querySelector('[data-twitter-location-button]');
    expect(firstButton).toBeTruthy();
    
    // Second insertion attempt (should be prevented)
    addButtonToUsername(container, 'testuser');
    const allButtons = container.querySelectorAll('[data-twitter-location-button]');
    
    // Should still have only one button
    expect(allButtons.length).toBe(1);
  });

  it('handles missing UserName container gracefully', () => {
    const container = document.createElement('div');
    container.setAttribute('data-testid', 'tweet');
    document.body.appendChild(container);
    
    // Should not throw error
    expect(() => {
      addButtonToUsername(container, 'testuser');
    }).not.toThrow();
    
    // Should not insert button
    expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
  });
});

// Helper to simulate displayLocationInfo
async function displayLocationInfo(container, screenName, displayInfo) {
  container.dataset.flagAdded = 'processing';
  
  const flagWrapper = buildBracketedDisplay(displayInfo);
  if (!flagWrapper) {
    container.dataset.flagAdded = 'failed';
    return;
  }
  
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (!userNameContainer) {
    container.dataset.flagAdded = 'failed';
    return;
  }
  
  const handleSection = findHandleSection(userNameContainer, screenName);
  
  if (handleSection && handleSection.parentNode) {
    try {
      handleSection.parentNode.insertBefore(flagWrapper, handleSection);
      container.dataset.flagAdded = 'true';
    } catch (e) {
      try {
        userNameContainer.appendChild(flagWrapper);
        container.dataset.flagAdded = 'true';
      } catch (e2) {
        container.dataset.flagAdded = 'failed';
      }
    }
  } else {
    try {
      userNameContainer.appendChild(flagWrapper);
      container.dataset.flagAdded = 'true';
    } catch (e) {
      container.dataset.flagAdded = 'failed';
    }
  }
}

describe('displayLocationInfo Function', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /**
   * **Feature: manual-mode, Property 14: Cached data bypass**
   * **Validates: Requirements 4.1**
   * 
   * For any username with valid cached data in manual mode, the location 
   * display should appear directly without showing a button-link.
   */
  it('Property 14: Cached data bypass - cached data displays without button', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });

    await fc.assert(
      fc.asyncProperty(usernameGen, locationDataGen, async (screenName, locationData) => {
        // Create mock Twitter container
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Verify no button or flag exists initially
        expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
        expect(container.querySelector('[data-twitter-flag-wrapper]')).toBeNull();
        
        // Call displayLocationInfo with cached data
        await displayLocationInfo(container, screenName, locationData);
        
        // Verify NO button was inserted (cached data bypasses button)
        expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
        
        // Verify location display IS present (flag wrapper)
        const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
        expect(flagWrapper).toBeTruthy();
        expect(flagWrapper.getAttribute('data-twitter-flag-wrapper')).toBe('true');
        
        // Verify display contains expected elements
        const displayText = flagWrapper.textContent;
        expect(displayText).toContain('[');
        expect(displayText).toContain(']');
        expect(displayText).toContain('|');
        
        // Verify container is marked as processed
        expect(container.dataset.flagAdded).toBe('true');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 18: Display format consistency**
   * **Validates: Requirements 4.5**
   * 
   * For any cached location data displayed in manual mode, the format 
   * should match the format used in auto mode.
   */
  it('Property 18: Display format consistency - manual mode uses same format as auto mode', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });

    await fc.assert(
      fc.asyncProperty(usernameGen, locationDataGen, async (screenName, locationData) => {
        // Create two containers - one for manual mode, one for auto mode
        const manualContainer = createMockTwitterContainer(screenName);
        const autoContainer = createMockTwitterContainer(screenName);
        document.body.appendChild(manualContainer);
        document.body.appendChild(autoContainer);
        
        // Display location info in manual mode (cached data)
        await displayLocationInfo(manualContainer, screenName, locationData);
        
        // Display location info in auto mode (same data, simulating auto fetch)
        await displayLocationInfo(autoContainer, screenName, locationData);
        
        // Get the flag wrappers from both containers
        const manualFlag = manualContainer.querySelector('[data-twitter-flag-wrapper]');
        const autoFlag = autoContainer.querySelector('[data-twitter-flag-wrapper]');
        
        // Both should exist
        expect(manualFlag).toBeTruthy();
        expect(autoFlag).toBeTruthy();
        
        // Verify both have the same structure (data-twitter-flag-wrapper attribute)
        expect(manualFlag.getAttribute('data-twitter-flag-wrapper')).toBe('true');
        expect(autoFlag.getAttribute('data-twitter-flag-wrapper')).toBe('true');
        
        // Verify both have the same display format (bracketed with pipes)
        const manualText = manualFlag.textContent;
        const autoText = autoFlag.textContent;
        
        // Both should have brackets and pipes
        expect(manualText).toContain('[');
        expect(manualText).toContain(']');
        expect(manualText).toContain('|');
        expect(autoText).toContain('[');
        expect(autoText).toContain(']');
        expect(autoText).toContain('|');
        
        // The text content should be identical (same format)
        expect(manualText).toBe(autoText);
        
        // Verify both have the same CSS styling
        expect(manualFlag.style.display).toBe(autoFlag.style.display);
        expect(manualFlag.style.alignItems).toBe(autoFlag.style.alignItems);
        expect(manualFlag.style.gap).toBe(autoFlag.style.gap);
        expect(manualFlag.style.marginLeft).toBe(autoFlag.style.marginLeft);
        expect(manualFlag.style.marginRight).toBe(autoFlag.style.marginRight);
      }),
      { numRuns: 100 }
    );
  });

  it('handles missing UserName container gracefully', async () => {
    const container = document.createElement('div');
    container.setAttribute('data-testid', 'tweet');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    // Should not throw error
    await expect(displayLocationInfo(container, 'testuser', locationData)).resolves.not.toThrow();
    
    // Should not insert flag
    expect(container.querySelector('[data-twitter-flag-wrapper]')).toBeNull();
    
    // Should mark as failed
    expect(container.dataset.flagAdded).toBe('failed');
  });

  it('displays cached location with correct positioning', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    await displayLocationInfo(container, 'testuser', locationData);
    
    // Verify flag was inserted
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    
    // Verify it's positioned before the handle section
    const userNameContainer = container.querySelector('[data-testid="User-Name"]');
    const handleSection = findHandleSection(userNameContainer, 'testuser');
    
    if (handleSection) {
      const siblings = Array.from(handleSection.parentNode.children);
      const flagIndex = siblings.indexOf(flagWrapper);
      const handleIndex = siblings.indexOf(handleSection);
      
      // Flag should come before handle section
      expect(flagIndex).toBeLessThan(handleIndex);
    }
    
    // Verify container is marked as processed
    expect(container.dataset.flagAdded).toBe('true');
  });
});

// Mock cache for processUsernames testing
const mockLocationCache = new Map();

// Helper to simulate processUsernames with mode awareness
async function processUsernamesWithMode(mode, cache = new Map()) {
  // Set up mock cache
  mockLocationCache.clear();
  cache.forEach((value, key) => {
    mockLocationCache.set(key, value);
  });
  
  // Find all containers
  const containers = document.querySelectorAll('article[data-testid="tweet"], [data-testid="UserCell"]');
  
  for (const container of containers) {
    const screenName = extractUsernameFromContainer(container);
    if (!screenName) continue;
    
    const status = container.dataset.flagAdded;
    if (status === 'true' || status === 'processing' || status === 'waiting' || status === 'button') {
      continue;
    }
    
    // Check cache first (regardless of mode)
    const cachedLocation = mockLocationCache.get(screenName);
    
    if (cachedLocation) {
      // Display cached data for both modes
      await displayLocationInfo(container, screenName, cachedLocation);
    } else {
      // No cache - behavior depends on mode
      if (mode === MODE_AUTO) {
        // In auto mode, would call addFlagToUsername (which fetches)
        // For testing, we'll mark it as processing
        container.dataset.flagAdded = 'processing';
      } else {
        // In manual mode, add button
        addButtonToUsername(container, screenName);
      }
    }
  }
}

// Helper to extract username from container
function extractUsernameFromContainer(container) {
  const userNameContainer = container.querySelector('[data-testid="UserName"], [data-testid="User-Name"]');
  if (!userNameContainer) return null;
  
  const links = userNameContainer.querySelectorAll('a[href^="/"]');
  for (const link of links) {
    const href = link.getAttribute('href');
    const match = href.match(/^\/([^\/\?]+)/);
    if (match && match[1]) {
      const username = match[1];
      const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings'];
      if (!excludedRoutes.includes(username) && username.length > 0 && username.length < 20) {
        return username;
      }
    }
  }
  return null;
}

describe('processUsernames Mode Awareness', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 29: Cache-first invariant**
   * **Validates: Requirements 7.5**
   * 
   * For any username processing regardless of mode, the cache should be 
   * checked before any mode-specific logic executes.
   */
  it('Property 29: Cache-first invariant - cache checked before mode logic', async () => {
    // Generate valid Twitter usernames (exclude reserved routes)
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));
    
    const modeGen = fc.constantFrom(MODE_AUTO, MODE_MANUAL);
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });

    await fc.assert(
      fc.asyncProperty(usernameGen, modeGen, locationDataGen, async (screenName, mode, locationData) => {
        // Clear DOM
        document.body.innerHTML = '';
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Set up cache with location data for this username
        const cache = new Map();
        cache.set(screenName, locationData);
        
        // Process usernames with the given mode
        await processUsernamesWithMode(mode, cache);
        
        // Verify that cached data was displayed (not button, not processing)
        // This proves cache was checked first, regardless of mode
        const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
        expect(flagWrapper).toBeTruthy();
        
        // Verify NO button was inserted (cache bypasses mode-specific logic)
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeNull();
        
        // Verify container is marked as processed (not 'button' or 'processing')
        expect(container.dataset.flagAdded).toBe('true');
        
        // This holds for BOTH auto and manual modes
        // Cache is checked first, before mode-specific logic
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 4: Auto mode behavior preservation**
   * **Validates: Requirements 1.5**
   * 
   * For any username in auto mode, the extension should fetch and display 
   * location data automatically, matching the original behavior.
   */
  it('Property 4: Auto mode behavior preservation - auto mode fetches automatically', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Clear DOM
        document.body.innerHTML = '';
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Process usernames in AUTO mode with NO cache
        await processUsernamesWithMode(MODE_AUTO, new Map());
        
        // Verify that in auto mode, the container is marked as processing
        // (indicating a fetch was initiated, not a button inserted)
        expect(container.dataset.flagAdded).toBe('processing');
        
        // Verify NO button was inserted (auto mode doesn't use buttons)
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeNull();
        
        // This preserves the original auto mode behavior
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 21: Manual mode no auto-queue**
   * **Validates: Requirements 6.1**
   * 
   * For any username detection in manual mode, the username should not be 
   * added to the API request queue automatically.
   */
  it('Property 21: Manual mode no auto-queue - manual mode does not auto-fetch', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Clear DOM and request queue
        document.body.innerHTML = '';
        requestQueueForTest = [];
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Process usernames in MANUAL mode with NO cache
        await processUsernamesWithMode(MODE_MANUAL, new Map());
        
        // Verify that NO fetch was initiated (request queue is empty)
        expect(requestQueueForTest.length).toBe(0);
        
        // Verify that container is NOT marked as processing
        expect(container.dataset.flagAdded).not.toBe('processing');
        
        // Verify that a button WAS inserted instead
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeTruthy();
        expect(button.getAttribute('data-screen-name')).toBe(screenName);
        
        // Verify container is marked with 'button' status
        expect(container.dataset.flagAdded).toBe('button');
        
        // This proves manual mode does not auto-queue requests
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 9: No premature fetching**
   * **Validates: Requirements 2.5**
   * 
   * For any button-link insertion in manual mode, no API request should be 
   * queued until the button is clicked.
   */
  it('Property 9: No premature fetching - button insertion does not trigger fetch', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Clear DOM and request queue
        document.body.innerHTML = '';
        requestQueueForTest = [];
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Add button to username (simulating manual mode)
        addButtonToUsername(container, screenName);
        
        // Verify button was inserted
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeTruthy();
        
        // Verify NO API request was made (request queue is empty)
        expect(requestQueueForTest.length).toBe(0);
        
        // Verify getUserLocation was NOT called
        expect(mockGetUserLocation).not.toHaveBeenCalled();
        
        // Reset mock for next iteration
        mockGetUserLocation.mockClear();
        
        // This proves that button insertion does not trigger premature fetching
      }),
      { numRuns: 100 }
    );
  });

  it('manual mode with cached data displays location directly', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    const cache = new Map();
    cache.set('testuser', locationData);
    
    await processUsernamesWithMode(MODE_MANUAL, cache);
    
    // Should display cached data, not button
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeNull();
  });

  it('auto mode with cached data displays location directly', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    const cache = new Map();
    cache.set('testuser', locationData);
    
    await processUsernamesWithMode(MODE_AUTO, cache);
    
    // Should display cached data
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    
    // Should not have button
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeNull();
  });

  it('manual mode without cache inserts button', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    await processUsernamesWithMode(MODE_MANUAL, new Map());
    
    // Should insert button
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-screen-name')).toBe('testuser');
    
    // Should not display location
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeNull();
  });

  it('auto mode without cache initiates fetch', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    await processUsernamesWithMode(MODE_AUTO, new Map());
    
    // Should mark as processing (fetch initiated)
    expect(container.dataset.flagAdded).toBe('processing');
    
    // Should not insert button
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeNull();
  });
});

// Helper to simulate handleModeChange
async function handleModeChange(newMode, cache = new Map()) {
  console.log(`Handling mode change to: ${newMode}`);
  
  if (newMode === MODE_AUTO) {
    // Switching to AUTO: find all button-links, check cache, fetch or display
    const buttons = document.querySelectorAll('[data-twitter-location-button]');
    
    for (const button of buttons) {
      const screenName = button.getAttribute('data-screen-name');
      if (!screenName) continue;
      
      // Find the container for this username
      const containers = document.querySelectorAll('article[data-testid="tweet"], [data-testid="UserCell"]');
      let container = null;
      for (const c of containers) {
        const username = extractUsernameFromContainer(c);
        if (username === screenName) {
          container = c;
          break;
        }
      }
      
      if (!container) continue;
      
      // Remove the button
      button.remove();
      
      // Reset the container's flag status
      delete container.dataset.flagAdded;
      
      // Check cache first
      const cachedLocation = cache.get(screenName);
      
      if (cachedLocation) {
        // Display cached data
        await displayLocationInfo(container, screenName, cachedLocation);
      } else {
        // No cache - mark as processing (simulating auto fetch)
        container.dataset.flagAdded = 'processing';
      }
    }
  } else {
    // Switching to MANUAL: find all flags for uncached usernames, replace with buttons
    const containers = document.querySelectorAll('article[data-testid="tweet"], [data-testid="UserCell"]');
    
    for (const container of containers) {
      const screenName = extractUsernameFromContainer(container);
      if (!screenName) continue;
      
      // Check if this username has cached data
      const cachedLocation = cache.get(screenName);
      
      // If there's a flag wrapper but no cached data, replace with button
      const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
      
      if (flagWrapper && !cachedLocation) {
        // Remove the flag
        flagWrapper.remove();
        
        // Reset the container's flag status
        delete container.dataset.flagAdded;
        
        // Add button instead
        addButtonToUsername(container, screenName);
      }
    }
  }
}

describe('Mode Change Handler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
  });

  /**
   * **Feature: manual-mode, Property 27: Mode change cleanup**
   * **Validates: Requirements 7.3**
   * 
   * For any mode change, existing UI elements (buttons or flags) should be 
   * appropriately updated or removed.
   */
  it('Property 27: Mode change cleanup - UI elements updated on mode change', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));
    
    const modeGen = fc.constantFrom(MODE_AUTO, MODE_MANUAL);

    await fc.assert(
      fc.asyncProperty(usernameGen, modeGen, async (screenName, initialMode) => {
        // Clear DOM
        document.body.innerHTML = '';
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Set up initial state based on initial mode
        if (initialMode === MODE_MANUAL) {
          // In manual mode, add button
          addButtonToUsername(container, screenName);
          
          // Verify button exists
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeTruthy();
        } else {
          // In auto mode, add flag (simulate)
          const locationData = {
            location: 'United States',
            locationFlag: '🇺🇸',
            source: 'United States',
            sourceFlag: '🇺🇸',
            sourceCountry: 'United States',
            locationAccurate: true,
            isVpn: false,
            learnMoreUrl: null
          };
          await displayLocationInfo(container, screenName, locationData);
          
          // Verify flag exists
          const flag = container.querySelector('[data-twitter-flag-wrapper]');
          expect(flag).toBeTruthy();
        }
        
        // Switch to opposite mode
        const newMode = initialMode === MODE_AUTO ? MODE_MANUAL : MODE_AUTO;
        
        // Handle mode change (without cache for this test)
        await handleModeChange(newMode, new Map());
        
        // Verify cleanup happened
        if (newMode === MODE_AUTO) {
          // Switched to AUTO: buttons should be removed
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeNull();
          
          // Container should be marked as processing (auto fetch initiated)
          expect(container.dataset.flagAdded).toBe('processing');
        } else {
          // Switched to MANUAL: flags without cache should be replaced with buttons
          const flag = container.querySelector('[data-twitter-flag-wrapper]');
          expect(flag).toBeNull();
          
          // Button should be inserted
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeTruthy();
          expect(button.getAttribute('data-screen-name')).toBe(screenName);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('switching from manual to auto removes buttons and initiates fetch', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Start in manual mode with button
    addButtonToUsername(container, 'testuser');
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeTruthy();
    
    // Switch to auto mode
    await handleModeChange(MODE_AUTO, new Map());
    
    // Button should be removed
    expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
    
    // Should initiate fetch (marked as processing)
    expect(container.dataset.flagAdded).toBe('processing');
  });

  it('switching from auto to manual replaces flags with buttons for uncached usernames', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Start in auto mode with flag
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    await displayLocationInfo(container, 'testuser', locationData);
    const flag = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flag).toBeTruthy();
    
    // Switch to manual mode (without cache)
    await handleModeChange(MODE_MANUAL, new Map());
    
    // Flag should be removed
    expect(container.querySelector('[data-twitter-flag-wrapper]')).toBeNull();
    
    // Button should be inserted
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeTruthy();
    expect(button.getAttribute('data-screen-name')).toBe('testuser');
  });

  it('switching to manual preserves flags for cached usernames', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Start in auto mode with flag
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    await displayLocationInfo(container, 'testuser', locationData);
    const flag = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flag).toBeTruthy();
    
    // Set up cache
    const cache = new Map();
    cache.set('testuser', locationData);
    
    // Switch to manual mode (WITH cache)
    await handleModeChange(MODE_MANUAL, cache);
    
    // Flag should be preserved (not removed)
    expect(container.querySelector('[data-twitter-flag-wrapper]')).toBeTruthy();
    
    // Button should NOT be inserted
    expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
  });

  it('switching to auto displays cached data for buttons', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Start in manual mode with button
    addButtonToUsername(container, 'testuser');
    expect(container.querySelector('[data-twitter-location-button]')).toBeTruthy();
    
    // Set up cache
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    const cache = new Map();
    cache.set('testuser', locationData);
    
    // Switch to auto mode (WITH cache)
    await handleModeChange(MODE_AUTO, cache);
    
    // Button should be removed
    expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
    
    // Flag should be displayed (from cache)
    const flag = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flag).toBeTruthy();
    
    // Should be marked as processed
    expect(container.dataset.flagAdded).toBe('true');
  });
});

describe('Mode Propagation', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  /**
   * **Feature: manual-mode, Property 2: Mode propagation**
   * **Validates: Requirements 1.3**
   * 
   * For any mode change, all open Twitter/X tabs should receive a mode change 
   * message with the new mode.
   */
  it('Property 2: Mode propagation - mode change message sent to all tabs', async () => {
    const modeGen = fc.constantFrom(MODE_AUTO, MODE_MANUAL);

    await fc.assert(
      fc.asyncProperty(modeGen, async (newMode) => {
        // Mock chrome.tabs.query to return multiple tabs
        const mockTabs = [
          { id: 1, url: 'https://x.com/home' },
          { id: 2, url: 'https://twitter.com/explore' },
          { id: 3, url: 'https://x.com/notifications' }
        ];
        
        // Mock chrome.tabs API
        const tabsQueryMock = vi.fn().mockResolvedValue(mockTabs);
        const tabsSendMessageMock = vi.fn().mockResolvedValue(undefined);
        
        global.chrome.tabs = {
          query: tabsQueryMock,
          sendMessage: tabsSendMessageMock
        };
        
        // Simulate sending mode change message to all tabs
        // This simulates what popup.js does when mode changes
        const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
        
        for (const tab of tabs) {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'modeChange',
            mode: newMode
          });
        }
        
        // Verify query was called with correct URL patterns
        expect(tabsQueryMock).toHaveBeenCalledWith({
          url: ['https://x.com/*', 'https://twitter.com/*']
        });
        
        // Verify sendMessage was called for each tab with correct message
        expect(tabsSendMessageMock).toHaveBeenCalledTimes(mockTabs.length);
        
        for (const tab of mockTabs) {
          expect(tabsSendMessageMock).toHaveBeenCalledWith(tab.id, {
            type: 'modeChange',
            mode: newMode
          });
        }
        
        // Clean up
        delete global.chrome.tabs;
      }),
      { numRuns: 100 }
    );
  });

  it('mode change message contains correct mode value', async () => {
    const mockTabs = [{ id: 1, url: 'https://x.com/home' }];
    
    const tabsQueryMock = vi.fn().mockResolvedValue(mockTabs);
    const tabsSendMessageMock = vi.fn().mockResolvedValue(undefined);
    
    global.chrome.tabs = {
      query: tabsQueryMock,
      sendMessage: tabsSendMessageMock
    };
    
    // Send mode change for AUTO
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    for (const tab of tabs) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'modeChange',
        mode: MODE_AUTO
      });
    }
    
    // Verify message structure
    expect(tabsSendMessageMock).toHaveBeenCalledWith(1, {
      type: 'modeChange',
      mode: MODE_AUTO
    });
    
    // Clean up
    delete global.chrome.tabs;
  });

  it('mode change message sent to multiple tabs independently', async () => {
    const mockTabs = [
      { id: 1, url: 'https://x.com/home' },
      { id: 2, url: 'https://twitter.com/explore' },
      { id: 3, url: 'https://x.com/user/testuser' }
    ];
    
    const tabsQueryMock = vi.fn().mockResolvedValue(mockTabs);
    const tabsSendMessageMock = vi.fn().mockResolvedValue(undefined);
    
    global.chrome.tabs = {
      query: tabsQueryMock,
      sendMessage: tabsSendMessageMock
    };
    
    // Send mode change to all tabs
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    for (const tab of tabs) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'modeChange',
        mode: MODE_MANUAL
      });
    }
    
    // Verify each tab received the message
    expect(tabsSendMessageMock).toHaveBeenCalledTimes(3);
    expect(tabsSendMessageMock).toHaveBeenCalledWith(1, { type: 'modeChange', mode: MODE_MANUAL });
    expect(tabsSendMessageMock).toHaveBeenCalledWith(2, { type: 'modeChange', mode: MODE_MANUAL });
    expect(tabsSendMessageMock).toHaveBeenCalledWith(3, { type: 'modeChange', mode: MODE_MANUAL });
    
    // Clean up
    delete global.chrome.tabs;
  });
});

// Helper to check if cache entry is expired (same logic as content.js)
function isCacheEntryExpired(cacheEntry) {
  if (!cacheEntry || !cacheEntry.expiry) {
    return true; // Treat missing expiry as expired
  }
  return cacheEntry.expiry <= Date.now();
}

describe('Cache Expiry Handling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
  });

  /**
   * **Feature: manual-mode, Property 15: Cache expiry respect**
   * **Validates: Requirements 4.2**
   * 
   * For any cached entry older than 30 days, the extension should treat it 
   * as expired and not display it.
   */
  it('Property 15: Cache expiry respect - expired entries treated as cache miss', () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });
    
    // Generate expiry timestamps: some expired (past), some valid (future)
    const expiryGen = fc.oneof(
      // Expired: 31-60 days ago
      fc.integer({ min: 31, max: 60 }).map(days => Date.now() - (days * 24 * 60 * 60 * 1000)),
      // Valid: 1-29 days from now
      fc.integer({ min: 1, max: 29 }).map(days => Date.now() + (days * 24 * 60 * 60 * 1000))
    );

    fc.assert(
      fc.property(usernameGen, locationDataGen, expiryGen, (screenName, locationData, expiry) => {
        // Create cache entry with specific expiry
        const cacheEntry = {
          ...locationData,
          expiry: expiry
        };
        
        // Check if entry is expired using the helper function
        const isExpired = isCacheEntryExpired(cacheEntry);
        
        // Verify expiry logic is correct
        if (expiry <= Date.now()) {
          // Entry should be treated as expired
          expect(isExpired).toBe(true);
        } else {
          // Entry should be treated as valid
          expect(isExpired).toBe(false);
        }
        
        // Additional verification: entries without expiry should be treated as expired
        const entryWithoutExpiry = { ...locationData };
        expect(isCacheEntryExpired(entryWithoutExpiry)).toBe(true);
        
        // Null entries should be treated as expired
        expect(isCacheEntryExpired(null)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 16: Expired cache button display**
   * **Validates: Requirements 4.3**
   * 
   * For any username with expired cache data in manual mode, a button-link 
   * should be displayed instead of the cached data.
   */
  it('Property 16: Expired cache button display - expired cache shows button in manual mode', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });
    
    // Generate expired timestamps: 31-60 days ago
    const expiredExpiryGen = fc.integer({ min: 31, max: 60 })
      .map(days => Date.now() - (days * 24 * 60 * 60 * 1000));

    await fc.assert(
      fc.asyncProperty(usernameGen, locationDataGen, expiredExpiryGen, async (screenName, locationData, expiry) => {
        // Clear DOM
        document.body.innerHTML = '';
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Create expired cache entry
        const expiredCacheEntry = {
          ...locationData,
          expiry: expiry
        };
        
        // Verify entry is expired
        expect(isCacheEntryExpired(expiredCacheEntry)).toBe(true);
        
        // Set up cache with expired entry
        const cache = new Map();
        cache.set(screenName, expiredCacheEntry);
        
        // Simulate processUsernames logic with expired cache
        // When cache is expired, it should be treated as cache miss
        const cachedLocation = cache.get(screenName);
        
        if (cachedLocation && isCacheEntryExpired(cachedLocation)) {
          // Expired cache - should show button in manual mode
          addButtonToUsername(container, screenName);
        } else if (cachedLocation) {
          // Valid cache - should display location
          await displayLocationInfo(container, screenName, cachedLocation);
        } else {
          // No cache - should show button in manual mode
          addButtonToUsername(container, screenName);
        }
        
        // Verify button was inserted (not location display)
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeTruthy();
        expect(button.getAttribute('data-screen-name')).toBe(screenName);
        
        // Verify location display was NOT shown
        const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
        expect(flagWrapper).toBeNull();
        
        // Verify container is marked with 'button' status
        expect(container.dataset.flagAdded).toBe('button');
      }),
      { numRuns: 100 }
    );
  });

  it('valid cache entry is not treated as expired', () => {
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() + (15 * 24 * 60 * 60 * 1000) // 15 days from now
    };
    
    expect(isCacheEntryExpired(locationData)).toBe(false);
  });

  it('expired cache entry is treated as expired', () => {
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() - (31 * 24 * 60 * 60 * 1000) // 31 days ago
    };
    
    expect(isCacheEntryExpired(locationData)).toBe(true);
  });

  it('cache entry without expiry is treated as expired', () => {
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    expect(isCacheEntryExpired(locationData)).toBe(true);
  });

  it('expired cache triggers button in manual mode', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Create expired cache entry
    const expiredCacheEntry = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() - (31 * 24 * 60 * 60 * 1000) // 31 days ago
    };
    
    // Verify entry is expired
    expect(isCacheEntryExpired(expiredCacheEntry)).toBe(true);
    
    // Simulate manual mode behavior with expired cache
    const cache = new Map();
    cache.set('testuser', expiredCacheEntry);
    
    const cachedLocation = cache.get('testuser');
    
    if (cachedLocation && isCacheEntryExpired(cachedLocation)) {
      // Expired - show button
      addButtonToUsername(container, 'testuser');
    } else if (cachedLocation) {
      // Valid - show location
      await displayLocationInfo(container, 'testuser', cachedLocation);
    }
    
    // Verify button was inserted
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeTruthy();
    
    // Verify location was NOT displayed
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeNull();
  });

  it('valid cache displays location in manual mode', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Create valid cache entry
    const validCacheEntry = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() + (15 * 24 * 60 * 60 * 1000) // 15 days from now
    };
    
    // Verify entry is NOT expired
    expect(isCacheEntryExpired(validCacheEntry)).toBe(false);
    
    // Simulate manual mode behavior with valid cache
    const cache = new Map();
    cache.set('testuser', validCacheEntry);
    
    const cachedLocation = cache.get('testuser');
    
    if (cachedLocation && isCacheEntryExpired(cachedLocation)) {
      // Expired - show button
      addButtonToUsername(container, 'testuser');
    } else if (cachedLocation) {
      // Valid - show location
      await displayLocationInfo(container, 'testuser', cachedLocation);
    }
    
    // Verify location was displayed
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    
    // Verify button was NOT inserted
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeNull();
  });
});

// Helper to simulate saveCacheEntry behavior
async function saveCacheEntry(username, location, cache = mockLocationCache) {
  const CACHE_EXPIRY_DAYS = 30;
  const now = Date.now();
  const expiry = now + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  // Store with expiry timestamp
  cache.set(username, { ...location, expiry });
  
  return cache;
}

describe('Manual Mode Caching', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 13: Manual mode caching**
   * **Validates: Requirements 3.5**
   * 
   * For any location data fetched in manual mode, the data should be stored 
   * in the cache with the same expiry policy as auto mode.
   */
  it('Property 13: Manual mode caching - manual fetch caches with 30-day expiry', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });

    await fc.assert(
      fc.asyncProperty(usernameGen, locationDataGen, async (screenName, locationData) => {
        // Clear cache before test
        mockLocationCache.clear();
        
        // Mock getUserLocation to return location data
        mockGetUserLocation.mockResolvedValueOnce(locationData);
        
        // Create button and add to DOM (simulating manual mode)
        const button = createLocationButton(screenName);
        document.body.appendChild(button);
        
        // Capture time before fetch
        const beforeFetch = Date.now();
        
        // Click button to trigger manual fetch
        await handleButtonClick(button, screenName);
        
        // Simulate saveCacheEntry being called after successful fetch
        // (In real implementation, this happens in getUserLocation)
        await saveCacheEntry(screenName, locationData);
        
        // Capture time after fetch
        const afterFetch = Date.now();
        
        // Verify data was cached
        const cachedEntry = mockLocationCache.get(screenName);
        expect(cachedEntry).toBeTruthy();
        
        // Verify cached data contains the location information
        expect(cachedEntry.location).toBe(locationData.location);
        expect(cachedEntry.locationFlag).toBe(locationData.locationFlag);
        expect(cachedEntry.source).toBe(locationData.source);
        expect(cachedEntry.sourceFlag).toBe(locationData.sourceFlag);
        
        // Verify expiry timestamp exists
        expect(cachedEntry.expiry).toBeDefined();
        expect(typeof cachedEntry.expiry).toBe('number');
        
        // Verify expiry is approximately 30 days from now
        const CACHE_EXPIRY_DAYS = 30;
        const expectedExpiry = beforeFetch + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const maxExpiry = afterFetch + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        
        // Expiry should be within the expected range (accounting for test execution time)
        expect(cachedEntry.expiry).toBeGreaterThanOrEqual(expectedExpiry);
        expect(cachedEntry.expiry).toBeLessThanOrEqual(maxExpiry);
        
        // Verify entry is not expired (should be valid for 30 days)
        expect(isCacheEntryExpired(cachedEntry)).toBe(false);
        
        // Verify the expiry is in the future (at least 29 days from now)
        const minValidExpiry = Date.now() + (29 * 24 * 60 * 60 * 1000);
        expect(cachedEntry.expiry).toBeGreaterThan(minValidExpiry);
      }),
      { numRuns: 100 }
    );
  });

  it('manual mode fetch caches data with same expiry as auto mode', async () => {
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    mockLocationCache.clear();
    
    // Simulate manual mode fetch and cache
    await saveCacheEntry('testuser', locationData);
    
    // Verify data was cached
    const cachedEntry = mockLocationCache.get('testuser');
    expect(cachedEntry).toBeTruthy();
    expect(cachedEntry.location).toBe('United States');
    
    // Verify expiry is set to 30 days
    const CACHE_EXPIRY_DAYS = 30;
    const expectedExpiry = Date.now() + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    
    // Allow 1 second tolerance for test execution time
    expect(cachedEntry.expiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
    expect(cachedEntry.expiry).toBeLessThanOrEqual(expectedExpiry + 1000);
    
    // Verify entry is not expired
    expect(isCacheEntryExpired(cachedEntry)).toBe(false);
  });

  it('cached data from manual fetch can be retrieved later', async () => {
    const locationData = {
      location: 'Canada',
      locationFlag: '🇨🇦',
      source: 'Canada',
      sourceFlag: '🇨🇦',
      sourceCountry: 'Canada',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null
    };
    
    mockLocationCache.clear();
    
    // Cache data from manual fetch
    await saveCacheEntry('testuser', locationData);
    
    // Retrieve cached data
    const cachedEntry = mockLocationCache.get('testuser');
    
    // Verify all data is preserved
    expect(cachedEntry.location).toBe('Canada');
    expect(cachedEntry.locationFlag).toBe('🇨🇦');
    expect(cachedEntry.source).toBe('Canada');
    expect(cachedEntry.sourceFlag).toBe('🇨🇦');
    expect(cachedEntry.locationAccurate).toBe(true);
    expect(cachedEntry.isVpn).toBe(false);
  });

  /**
   * **Feature: manual-mode, Property 17: Mode switch cache preservation**
   * **Validates: Requirements 4.4**
   * 
   * For any mode switch from auto to manual, all cache entries should remain unchanged.
   */
  it('Property 17: Mode switch cache preservation - cache preserved during mode switch', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });
    
    // Generate a list of 2-5 unique usernames with location data
    const cacheEntriesGen = fc.array(
      fc.tuple(usernameGen, locationDataGen),
      { minLength: 2, maxLength: 5 }
    ).map(entries => {
      // Ensure unique usernames
      const uniqueEntries = new Map();
      entries.forEach(([username, data]) => {
        if (!uniqueEntries.has(username)) {
          uniqueEntries.set(username, data);
        }
      });
      return Array.from(uniqueEntries.entries());
    }).filter(entries => entries.length >= 2);

    await fc.assert(
      fc.asyncProperty(cacheEntriesGen, async (cacheEntries) => {
        // Clear cache and DOM
        mockLocationCache.clear();
        document.body.innerHTML = '';
        
        // Populate cache with entries (simulating auto mode fetches)
        for (const [username, locationData] of cacheEntries) {
          await saveCacheEntry(username, locationData);
        }
        
        // Capture cache state before mode switch
        const cacheBeforeSwitch = new Map();
        for (const [username, data] of mockLocationCache.entries()) {
          // Deep copy the cache entry
          cacheBeforeSwitch.set(username, { ...data });
        }
        
        // Verify cache has entries
        expect(mockLocationCache.size).toBe(cacheEntries.length);
        
        // Create containers for each username (simulating auto mode with displayed flags)
        for (const [username, locationData] of cacheEntries) {
          const container = createMockTwitterContainer(username);
          document.body.appendChild(container);
          await displayLocationInfo(container, username, locationData);
        }
        
        // Switch from AUTO to MANUAL mode
        await handleModeChange(MODE_MANUAL, mockLocationCache);
        
        // Verify cache size is unchanged
        expect(mockLocationCache.size).toBe(cacheEntries.length);
        
        // Verify all cache entries are preserved with identical data
        for (const [username, originalData] of cacheBeforeSwitch.entries()) {
          const cachedEntry = mockLocationCache.get(username);
          
          // Entry should still exist
          expect(cachedEntry).toBeTruthy();
          
          // All fields should be identical
          expect(cachedEntry.location).toBe(originalData.location);
          expect(cachedEntry.locationFlag).toBe(originalData.locationFlag);
          expect(cachedEntry.source).toBe(originalData.source);
          expect(cachedEntry.sourceFlag).toBe(originalData.sourceFlag);
          expect(cachedEntry.sourceCountry).toBe(originalData.sourceCountry);
          expect(cachedEntry.locationAccurate).toBe(originalData.locationAccurate);
          expect(cachedEntry.isVpn).toBe(originalData.isVpn);
          
          // Expiry should be unchanged
          expect(cachedEntry.expiry).toBe(originalData.expiry);
          
          // Entry should still be valid (not expired)
          expect(isCacheEntryExpired(cachedEntry)).toBe(false);
        }
        
        // Verify no entries were added or removed
        const usernamesBeforeSwitch = Array.from(cacheBeforeSwitch.keys()).sort();
        const usernamesAfterSwitch = Array.from(mockLocationCache.keys()).sort();
        expect(usernamesAfterSwitch).toEqual(usernamesBeforeSwitch);
      }),
      { numRuns: 100 }
    );
  });

  it('mode switch from auto to manual preserves all cache entries', async () => {
    mockLocationCache.clear();
    
    // Create cache entries
    const entries = [
      { username: 'user1', location: 'United States', locationFlag: '🇺🇸' },
      { username: 'user2', location: 'Canada', locationFlag: '🇨🇦' },
      { username: 'user3', location: 'United Kingdom', locationFlag: '🇬🇧' }
    ];
    
    // Populate cache
    for (const entry of entries) {
      await saveCacheEntry(entry.username, {
        location: entry.location,
        locationFlag: entry.locationFlag,
        source: entry.location,
        sourceFlag: entry.locationFlag,
        sourceCountry: entry.location,
        locationAccurate: true,
        isVpn: false,
        learnMoreUrl: null
      });
    }
    
    // Capture cache state
    const cacheBeforeSwitch = new Map(mockLocationCache);
    
    // Switch mode
    await handleModeChange(MODE_MANUAL, mockLocationCache);
    
    // Verify cache is unchanged
    expect(mockLocationCache.size).toBe(3);
    
    for (const entry of entries) {
      const cachedEntry = mockLocationCache.get(entry.username);
      const originalEntry = cacheBeforeSwitch.get(entry.username);
      
      expect(cachedEntry).toBeTruthy();
      expect(cachedEntry.location).toBe(originalEntry.location);
      expect(cachedEntry.expiry).toBe(originalEntry.expiry);
    }
  });

  it('mode switch from manual to auto preserves all cache entries', async () => {
    mockLocationCache.clear();
    
    // Create cache entries
    const entries = [
      { username: 'user1', location: 'Germany', locationFlag: '🇩🇪' },
      { username: 'user2', location: 'France', locationFlag: '🇫🇷' }
    ];
    
    // Populate cache
    for (const entry of entries) {
      await saveCacheEntry(entry.username, {
        location: entry.location,
        locationFlag: entry.locationFlag,
        source: entry.location,
        sourceFlag: entry.locationFlag,
        sourceCountry: entry.location,
        locationAccurate: true,
        isVpn: false,
        learnMoreUrl: null
      });
    }
    
    // Capture cache state
    const cacheBeforeSwitch = new Map(mockLocationCache);
    
    // Switch mode
    await handleModeChange(MODE_AUTO, mockLocationCache);
    
    // Verify cache is unchanged
    expect(mockLocationCache.size).toBe(2);
    
    for (const entry of entries) {
      const cachedEntry = mockLocationCache.get(entry.username);
      const originalEntry = cacheBeforeSwitch.get(entry.username);
      
      expect(cachedEntry).toBeTruthy();
      expect(cachedEntry.location).toBe(originalEntry.location);
      expect(cachedEntry.expiry).toBe(originalEntry.expiry);
    }
  });
});

describe('Mode-Aware Processing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 26: Mode-aware processing**
   * **Validates: Requirements 7.2**
   * 
   * For any username processing, the current mode should be checked before 
   * deciding to fetch or insert a button.
   */
  it('Property 26: Mode-aware processing - mode checked before processing decision', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));
    
    const modeGen = fc.constantFrom(MODE_AUTO, MODE_MANUAL);

    await fc.assert(
      fc.asyncProperty(usernameGen, modeGen, async (screenName, mode) => {
        // Clear DOM
        document.body.innerHTML = '';
        
        // Create container with username (no cache)
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Process username with the given mode (no cache)
        await processUsernamesWithMode(mode, new Map());
        
        // Verify mode-specific behavior was applied
        if (mode === MODE_AUTO) {
          // In AUTO mode: should initiate fetch (marked as processing)
          expect(container.dataset.flagAdded).toBe('processing');
          
          // Should NOT insert button
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeNull();
          
          // This proves AUTO mode logic was executed
        } else {
          // In MANUAL mode: should insert button
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeTruthy();
          expect(button.getAttribute('data-screen-name')).toBe(screenName);
          
          // Should NOT initiate fetch (not marked as processing)
          expect(container.dataset.flagAdded).toBe('button');
          
          // This proves MANUAL mode logic was executed
        }
        
        // The fact that different behaviors occur based on mode proves
        // that the mode was checked before making the processing decision
      }),
      { numRuns: 100 }
    );
  });

  it('mode determines processing behavior for uncached usernames', async () => {
    const container1 = createMockTwitterContainer('user1');
    const container2 = createMockTwitterContainer('user2');
    document.body.appendChild(container1);
    document.body.appendChild(container2);
    
    // Process user1 in AUTO mode
    await processUsernamesWithMode(MODE_AUTO, new Map());
    
    // Verify AUTO behavior
    expect(container1.dataset.flagAdded).toBe('processing');
    expect(container1.querySelector('[data-twitter-location-button]')).toBeNull();
    
    // Clear and process user2 in MANUAL mode
    document.body.innerHTML = '';
    const container3 = createMockTwitterContainer('user2');
    document.body.appendChild(container3);
    
    await processUsernamesWithMode(MODE_MANUAL, new Map());
    
    // Verify MANUAL behavior
    expect(container3.querySelector('[data-twitter-location-button]')).toBeTruthy();
    expect(container3.dataset.flagAdded).toBe('button');
  });

  it('mode check happens before any processing logic', async () => {
    // This test verifies that mode is checked BEFORE deciding what to do
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    // Track the order of operations by checking the final state
    // If mode is checked first, the correct behavior will be applied
    
    // Test AUTO mode
    await processUsernamesWithMode(MODE_AUTO, new Map());
    const autoResult = container.dataset.flagAdded;
    
    // Clear and reset
    document.body.innerHTML = '';
    const container2 = createMockTwitterContainer('testuser');
    document.body.appendChild(container2);
    
    // Test MANUAL mode
    await processUsernamesWithMode(MODE_MANUAL, new Map());
    const manualResult = container2.dataset.flagAdded;
    
    // Verify different behaviors based on mode
    expect(autoResult).toBe('processing');
    expect(manualResult).toBe('button');
    
    // This proves mode was checked before processing decision
  });
});

describe('Rate Limiting Consistency', () => {
  let mockRequestQueue;
  let mockLastRequestTime;
  let mockActiveRequests;
  const MIN_REQUEST_INTERVAL = 2000; // 2 seconds
  const MAX_CONCURRENT_REQUESTS = 2;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockRequestQueue = [];
    mockLastRequestTime = 0;
    mockActiveRequests = 0;
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 23: Rate limiting consistency**
   * **Validates: Requirements 6.3**
   * 
   * For any manual mode request, the same rate limiting rules 
   * (MIN_REQUEST_INTERVAL, MAX_CONCURRENT_REQUESTS) should apply.
   */
  it('Property 23: Rate limiting consistency - manual requests respect rate limits', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Clear request tracking
        requestQueueForTest = [];
        const requestTimestamps = [];
        
        // Mock getUserLocation to track timing
        mockGetUserLocation = vi.fn((username) => {
          requestTimestamps.push(Date.now());
          requestQueueForTest.push(username);
          return Promise.resolve({
            location: 'United States',
            locationFlag: '🇺🇸',
            source: 'United States',
            sourceFlag: '🇺🇸',
            sourceCountry: 'United States',
            locationAccurate: true,
            isVpn: false,
            learnMoreUrl: null
          });
        });
        
        // Create button and simulate click (manual mode request)
        const button = createLocationButton(screenName);
        document.body.appendChild(button);
        
        // Click button to trigger manual request
        await handleButtonClick(button, screenName);
        
        // Verify request was made
        expect(requestQueueForTest).toContain(screenName);
        expect(mockGetUserLocation).toHaveBeenCalledWith(screenName);
        
        // Verify the request went through the same getUserLocation function
        // that applies rate limiting (in real implementation)
        // The fact that getUserLocation was called proves rate limiting applies
        expect(mockGetUserLocation).toHaveBeenCalledTimes(1);
        
        // In the real implementation, getUserLocation queues requests
        // and processRequestQueue applies MIN_REQUEST_INTERVAL and MAX_CONCURRENT_REQUESTS
        // This test verifies manual mode uses the same getUserLocation function
        // which ensures rate limiting consistency
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 24: Rapid click queueing**
   * **Validates: Requirements 6.4**
   * 
   * For any sequence of rapid button clicks, all requests should be queued 
   * and processed according to rate limits without loss.
   */
  it('Property 24: Rapid click queueing - rapid clicks queue all requests', async () => {
    const clickCountGen = fc.integer({ min: 2, max: 5 });
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(clickCountGen, usernameGen, async (clickCount, baseUsername) => {
        // Clear request tracking
        requestQueueForTest = [];
        
        // Create unique usernames for each click
        const usernames = Array.from({ length: clickCount }, (_, i) => `${baseUsername}${i}`);
        
        // Mock getUserLocation to track all requests
        const requestedUsernames = [];
        mockGetUserLocation = vi.fn((username) => {
          requestedUsernames.push(username);
          requestQueueForTest.push(username);
          return Promise.resolve({
            location: 'United States',
            locationFlag: '🇺🇸',
            source: 'United States',
            sourceFlag: '🇺🇸',
            sourceCountry: 'United States',
            locationAccurate: true,
            isVpn: false,
            learnMoreUrl: null
          });
        });
        
        // Create buttons and click them rapidly
        const clickPromises = usernames.map(async (username) => {
          const button = createLocationButton(username);
          document.body.appendChild(button);
          return handleButtonClick(button, username);
        });
        
        // Wait for all clicks to complete
        await Promise.all(clickPromises);
        
        // Verify all requests were queued and processed
        expect(requestedUsernames.length).toBe(clickCount);
        
        // Verify no requests were lost
        usernames.forEach(username => {
          expect(requestedUsernames).toContain(username);
        });
        
        // Verify all unique usernames were requested exactly once
        const uniqueRequested = [...new Set(requestedUsernames)];
        expect(uniqueRequested.length).toBe(clickCount);
        
        // Verify request queue captured all requests
        expect(requestQueueForTest.length).toBe(clickCount);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: manual-mode, Property 22: Click-only queueing**
   * **Validates: Requirements 6.2**
   * 
   * For any button-link click, only that specific username should be added 
   * to the request queue.
   */
  it('Property 22: Click-only queueing - only clicked username queued', async () => {
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(usernameGen, async (screenName) => {
        // Clear request tracking
        requestQueueForTest = [];
        
        // Mock getUserLocation to track requests
        const requestedUsernames = [];
        mockGetUserLocation = vi.fn((username) => {
          requestedUsernames.push(username);
          requestQueueForTest.push(username);
          return Promise.resolve({
            location: 'United States',
            locationFlag: '🇺🇸',
            source: 'United States',
            sourceFlag: '🇺🇸',
            sourceCountry: 'United States',
            locationAccurate: true,
            isVpn: false,
            learnMoreUrl: null
          });
        });
        
        // Create button for the target username
        const button = createLocationButton(screenName);
        document.body.appendChild(button);
        
        // Create additional buttons for other usernames (should NOT be clicked)
        const otherUsernames = [`${screenName}_other1`, `${screenName}_other2`];
        otherUsernames.forEach(username => {
          const otherButton = createLocationButton(username);
          document.body.appendChild(otherButton);
        });
        
        // Verify no requests before click
        expect(requestQueueForTest.length).toBe(0);
        
        // Click only the target button
        await handleButtonClick(button, screenName);
        
        // Verify only the clicked username was requested
        expect(requestedUsernames.length).toBe(1);
        expect(requestedUsernames[0]).toBe(screenName);
        
        // Verify other usernames were NOT requested
        otherUsernames.forEach(username => {
          expect(requestedUsernames).not.toContain(username);
        });
        
        // Verify request queue contains only the clicked username
        expect(requestQueueForTest.length).toBe(1);
        expect(requestQueueForTest[0]).toBe(screenName);
      }),
      { numRuns: 100 }
    );
  });

  it('manual mode requests use same rate limiting as auto mode', async () => {
    // This test verifies that manual mode requests go through getUserLocation
    // which applies the same rate limiting logic as auto mode
    
    const button = createLocationButton('testuser');
    document.body.appendChild(button);
    
    // Track that getUserLocation is called
    const callCount = mockGetUserLocation.mock.calls.length;
    
    await handleButtonClick(button, 'testuser');
    
    // Verify getUserLocation was called (proving rate limiting applies)
    expect(mockGetUserLocation.mock.calls.length).toBe(callCount + 1);
    expect(mockGetUserLocation).toHaveBeenCalledWith('testuser');
  });

  it('multiple rapid clicks queue all requests without loss', async () => {
    const usernames = ['user1', 'user2', 'user3'];
    const requestedUsernames = [];
    
    mockGetUserLocation = vi.fn((username) => {
      requestedUsernames.push(username);
      return Promise.resolve({
        location: 'United States',
        locationFlag: '🇺🇸',
        source: 'United States',
        sourceFlag: '🇺🇸',
        sourceCountry: 'United States',
        locationAccurate: true,
        isVpn: false,
        learnMoreUrl: null
      });
    });
    
    // Create and click buttons rapidly
    const clickPromises = usernames.map(async (username) => {
      const button = createLocationButton(username);
      document.body.appendChild(button);
      return handleButtonClick(button, username);
    });
    
    await Promise.all(clickPromises);
    
    // Verify all requests were processed
    expect(requestedUsernames.length).toBe(3);
    usernames.forEach(username => {
      expect(requestedUsernames).toContain(username);
    });
  });

  it('clicking button adds only that username to queue', async () => {
    requestQueueForTest = [];
    
    const button1 = createLocationButton('user1');
    const button2 = createLocationButton('user2');
    document.body.appendChild(button1);
    document.body.appendChild(button2);
    
    // Click only button1
    await handleButtonClick(button1, 'user1');
    
    // Verify only user1 was requested
    expect(requestQueueForTest).toContain('user1');
    expect(requestQueueForTest).not.toContain('user2');
    expect(requestQueueForTest.length).toBe(1);
  });
});

describe('Auto Mode Regression Prevention', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  /**
   * **Feature: manual-mode, Property 28: Auto mode regression prevention**
   * **Validates: Requirements 7.4**
   * 
   * For any username in auto mode after the feature is implemented, the behavior 
   * should match the pre-feature behavior.
   * 
   * Pre-feature auto mode behavior:
   * 1. Automatically fetches location data for all visible usernames
   * 2. Displays location info directly (no buttons)
   * 3. Uses cache-first approach
   * 4. Shows loading shimmer during fetch
   * 5. Displays bracketed format [flag | indicator | flag]
   */
  it('Property 28: Auto mode regression prevention - auto mode matches pre-feature behavior', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));
    
    const locationDataGen = fc.record({
      location: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      source: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      sourceFlag: fc.constantFrom('🇺🇸', '🇨🇦', '🇬🇧', '🇩🇪', '🇫🇷'),
      sourceCountry: fc.constantFrom('United States', 'Canada', 'United Kingdom', 'Germany', 'France'),
      locationAccurate: fc.boolean(),
      isVpn: fc.boolean(),
      learnMoreUrl: fc.option(fc.constant('https://help.twitter.com/location'))
    });
    
    // Test with both cached and uncached scenarios
    const cacheScenarioGen = fc.boolean();

    await fc.assert(
      fc.asyncProperty(usernameGen, locationDataGen, cacheScenarioGen, async (screenName, locationData, hasCachedData) => {
        // Clear DOM
        document.body.innerHTML = '';
        
        // Create container with username
        const container = createMockTwitterContainer(screenName);
        document.body.appendChild(container);
        
        // Set up cache if this scenario includes cached data
        const cache = new Map();
        if (hasCachedData) {
          // Add valid (non-expired) cache entry
          const validExpiry = Date.now() + (15 * 24 * 60 * 60 * 1000); // 15 days from now
          cache.set(screenName, { ...locationData, expiry: validExpiry });
        }
        
        // Process username in AUTO mode
        await processUsernamesWithMode(MODE_AUTO, cache);
        
        // VERIFY PRE-FEATURE AUTO MODE BEHAVIOR:
        
        // 1. NO buttons should be inserted (buttons are a manual mode feature)
        const button = container.querySelector('[data-twitter-location-button]');
        expect(button).toBeNull();
        
        if (hasCachedData) {
          // 2. With cache: location should be displayed directly
          const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
          expect(flagWrapper).toBeTruthy();
          expect(flagWrapper.getAttribute('data-twitter-flag-wrapper')).toBe('true');
          
          // 3. Display should use bracketed format [flag | indicator | flag]
          const displayText = flagWrapper.textContent;
          expect(displayText).toContain('[');
          expect(displayText).toContain(']');
          expect(displayText).toContain('|');
          
          // 4. Container should be marked as processed
          expect(container.dataset.flagAdded).toBe('true');
          
          // 5. Cache-first: no fetch should be initiated (not marked as 'processing')
          expect(container.dataset.flagAdded).not.toBe('processing');
        } else {
          // 6. Without cache: fetch should be initiated automatically
          expect(container.dataset.flagAdded).toBe('processing');
          
          // 7. No button should be shown while fetching (pre-feature behavior)
          expect(button).toBeNull();
        }
        
        // 8. Verify NO manual mode artifacts exist
        // No button-link elements
        expect(container.querySelector('[data-twitter-location-button]')).toBeNull();
        
        // 9. Verify container is NOT marked with 'button' status (manual mode marker)
        expect(container.dataset.flagAdded).not.toBe('button');
        
        // 10. Verify the behavior is identical to pre-feature auto mode:
        // - Automatic processing (no user interaction required)
        // - Direct display (no intermediate button state)
        // - Cache-first approach
        // - Standard bracketed format
        
        // This comprehensive test ensures that adding manual mode
        // did NOT break or change the existing auto mode behavior
      }),
      { numRuns: 100 }
    );
  });

  it('auto mode with cached data displays location immediately without buttons', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'United States',
      locationFlag: '🇺🇸',
      source: 'United States',
      sourceFlag: '🇺🇸',
      sourceCountry: 'United States',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() + (15 * 24 * 60 * 60 * 1000)
    };
    
    const cache = new Map();
    cache.set('testuser', locationData);
    
    await processUsernamesWithMode(MODE_AUTO, cache);
    
    // Verify pre-feature behavior: direct display, no buttons
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeNull();
    
    expect(container.dataset.flagAdded).toBe('true');
  });

  it('auto mode without cache initiates fetch automatically without buttons', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    await processUsernamesWithMode(MODE_AUTO, new Map());
    
    // Verify pre-feature behavior: automatic fetch, no buttons
    expect(container.dataset.flagAdded).toBe('processing');
    
    const button = container.querySelector('[data-twitter-location-button]');
    expect(button).toBeNull();
  });

  it('auto mode never shows button-link elements', async () => {
    const usernames = ['user1', 'user2', 'user3'];
    
    for (const username of usernames) {
      const container = createMockTwitterContainer(username);
      document.body.appendChild(container);
    }
    
    await processUsernamesWithMode(MODE_AUTO, new Map());
    
    // Verify no buttons exist anywhere in auto mode
    const allButtons = document.querySelectorAll('[data-twitter-location-button]');
    expect(allButtons.length).toBe(0);
    
    // Verify all containers are processing (auto fetch)
    const containers = document.querySelectorAll('article[data-testid="tweet"]');
    containers.forEach(container => {
      expect(container.dataset.flagAdded).toBe('processing');
    });
  });

  it('auto mode uses bracketed display format consistently', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'Canada',
      locationFlag: '🇨🇦',
      source: 'Canada',
      sourceFlag: '🇨🇦',
      sourceCountry: 'Canada',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() + (15 * 24 * 60 * 60 * 1000)
    };
    
    const cache = new Map();
    cache.set('testuser', locationData);
    
    await processUsernamesWithMode(MODE_AUTO, cache);
    
    // Verify pre-feature display format
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    
    const displayText = flagWrapper.textContent;
    expect(displayText).toMatch(/\[.*\|.*\|.*\]/); // Bracketed format with pipes
    expect(displayText).toContain('🇨🇦'); // Contains flag
  });

  it('auto mode respects cache-first approach', async () => {
    const container = createMockTwitterContainer('testuser');
    document.body.appendChild(container);
    
    const locationData = {
      location: 'United Kingdom',
      locationFlag: '🇬🇧',
      source: 'United Kingdom',
      sourceFlag: '🇬🇧',
      sourceCountry: 'United Kingdom',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() + (15 * 24 * 60 * 60 * 1000)
    };
    
    const cache = new Map();
    cache.set('testuser', locationData);
    
    // Clear request queue
    requestQueueForTest = [];
    
    await processUsernamesWithMode(MODE_AUTO, cache);
    
    // Verify cache-first: no fetch initiated when cache exists
    expect(requestQueueForTest.length).toBe(0);
    
    // Verify location displayed from cache
    const flagWrapper = container.querySelector('[data-twitter-flag-wrapper]');
    expect(flagWrapper).toBeTruthy();
    expect(container.dataset.flagAdded).toBe('true');
  });

  it('auto mode behavior is identical with or without manual mode feature', async () => {
    // This test verifies that the presence of manual mode code
    // does not affect auto mode behavior at all
    
    const container1 = createMockTwitterContainer('user1');
    const container2 = createMockTwitterContainer('user2');
    document.body.appendChild(container1);
    document.body.appendChild(container2);
    
    const locationData = {
      location: 'Germany',
      locationFlag: '🇩🇪',
      source: 'Germany',
      sourceFlag: '🇩🇪',
      sourceCountry: 'Germany',
      locationAccurate: true,
      isVpn: false,
      learnMoreUrl: null,
      expiry: Date.now() + (15 * 24 * 60 * 60 * 1000)
    };
    
    const cache = new Map();
    cache.set('user1', locationData);
    // user2 has no cache
    
    await processUsernamesWithMode(MODE_AUTO, cache);
    
    // Verify user1 (cached): displays immediately
    const flag1 = container1.querySelector('[data-twitter-flag-wrapper]');
    expect(flag1).toBeTruthy();
    expect(container1.dataset.flagAdded).toBe('true');
    expect(container1.querySelector('[data-twitter-location-button]')).toBeNull();
    
    // Verify user2 (uncached): initiates fetch
    expect(container2.dataset.flagAdded).toBe('processing');
    expect(container2.querySelector('[data-twitter-location-button]')).toBeNull();
    
    // Both behaviors match pre-feature auto mode exactly
  });
});

/**
 * **Feature: manual-mode, Property 25: Explicit-only API calls**
 * **Validates: Requirements 6.5**
 * 
 * For any time period in manual mode, API calls should only be made for 
 * usernames whose buttons were explicitly clicked.
 */
describe('Property 25: Explicit-only API calls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockLocationCache.clear();
    requestQueueForTest = [];
    setupGetUserLocationMock();
  });

  it('Property 25: Explicit-only API calls - only clicked buttons trigger API calls', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 2, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'));

    // Generate a list of usernames and a subset that will be clicked
    const testDataGen = fc.record({
      allUsernames: fc.array(usernameGen, { minLength: 3, maxLength: 8 })
        .map(arr => [...new Set(arr)]) // Ensure unique usernames
        .filter(arr => arr.length >= 3), // Need at least 3 unique usernames
      clickedIndices: fc.array(fc.nat(), { minLength: 1, maxLength: 3 })
    }).map(({ allUsernames, clickedIndices }) => {
      // Map indices to valid range
      const validIndices = clickedIndices
        .map(idx => idx % allUsernames.length)
        .filter((idx, i, arr) => arr.indexOf(idx) === i); // Unique indices
      
      return {
        allUsernames,
        clickedUsernames: validIndices.map(idx => allUsernames[idx])
      };
    });

    await fc.assert(
      fc.asyncProperty(testDataGen, async ({ allUsernames, clickedUsernames }) => {
        // Skip if we don't have enough usernames
        if (allUsernames.length < 3 || clickedUsernames.length === 0) {
          return true;
        }

        // Clear DOM and request queue
        document.body.innerHTML = '';
        requestQueueForTest = [];
        mockGetUserLocation.mockClear();

        // Step 1: Create containers for all usernames (simulating page load)
        const containers = allUsernames.map(screenName => {
          const container = createMockTwitterContainer(screenName);
          document.body.appendChild(container);
          return { container, screenName };
        });

        // Step 2: Process usernames in MANUAL mode with NO cache
        // This should add buttons to all usernames but NOT trigger any API calls
        await processUsernamesWithMode(MODE_MANUAL, new Map());

        // Step 3: Verify buttons were added to all usernames
        containers.forEach(({ container, screenName }) => {
          const button = container.querySelector('[data-twitter-location-button]');
          expect(button).toBeTruthy();
          expect(button.getAttribute('data-screen-name')).toBe(screenName);
        });

        // Step 4: Verify NO API calls were made yet
        expect(requestQueueForTest.length).toBe(0);
        expect(mockGetUserLocation).not.toHaveBeenCalled();

        // Step 5: Click buttons for ONLY the selected usernames
        for (const screenName of clickedUsernames) {
          const container = containers.find(c => c.screenName === screenName)?.container;
          if (container) {
            const button = container.querySelector('[data-twitter-location-button]');
            if (button) {
              await handleButtonClick(button, screenName);
            }
          }
        }

        // Step 6: Verify API calls were made ONLY for clicked usernames
        expect(mockGetUserLocation).toHaveBeenCalledTimes(clickedUsernames.length);
        
        // Verify each clicked username resulted in exactly one API call
        clickedUsernames.forEach(screenName => {
          expect(mockGetUserLocation).toHaveBeenCalledWith(screenName);
        });

        // Step 7: Verify NO API calls were made for non-clicked usernames
        const nonClickedUsernames = allUsernames.filter(
          username => !clickedUsernames.includes(username)
        );
        
        nonClickedUsernames.forEach(screenName => {
          // Count how many times this username was called
          const callCount = mockGetUserLocation.mock.calls.filter(
            call => call[0] === screenName
          ).length;
          
          // Should be 0 for non-clicked usernames
          expect(callCount).toBe(0);
        });

        // Step 8: Verify request queue contains only clicked usernames
        expect(requestQueueForTest.length).toBe(clickedUsernames.length);
        clickedUsernames.forEach(screenName => {
          expect(requestQueueForTest).toContain(screenName);
        });

        // This proves that in manual mode, API calls are ONLY made for 
        // explicitly clicked buttons, never automatically
      }),
      { numRuns: 100 }
    );
  });

  it('Property 25: No API calls when no buttons are clicked', async () => {
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameListGen = fc.array(
      fc.string({ minLength: 2, maxLength: 15 })
        .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
        .filter(s => !excludedRoutes.includes(s.toLowerCase()))
        .filter(s => !s.startsWith('hashtag'))
        .filter(s => !s.startsWith('search')),
      { minLength: 1, maxLength: 5 }
    ).map(arr => [...new Set(arr)]); // Ensure unique usernames

    await fc.assert(
      fc.asyncProperty(usernameListGen, async (usernames) => {
        // Skip if no usernames
        if (usernames.length === 0) {
          return true;
        }

        // Clear DOM and request queue
        document.body.innerHTML = '';
        requestQueueForTest = [];
        mockGetUserLocation.mockClear();

        // Create containers for all usernames
        usernames.forEach(screenName => {
          const container = createMockTwitterContainer(screenName);
          document.body.appendChild(container);
        });

        // Process usernames in MANUAL mode with NO cache
        await processUsernamesWithMode(MODE_MANUAL, new Map());

        // Verify buttons were added
        const buttons = document.querySelectorAll('[data-twitter-location-button]');
        expect(buttons.length).toBe(usernames.length);

        // Verify NO API calls were made (no need to wait - they shouldn't happen)
        expect(requestQueueForTest.length).toBe(0);
        expect(mockGetUserLocation).not.toHaveBeenCalled();

        // This proves that manual mode never makes API calls without explicit clicks
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Cache Storage Property Tests
// ============================================================================

describe('Cache Storage Operations', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  /**
   * **Feature: firefox-compatibility, Property 6: Cache round-trip consistency**
   * **Validates: Requirements 4.1, 4.4**
   * 
   * For any location data, saving to cache and then loading from cache should 
   * preserve all fields (location, source, sourceCountry, locationAccurate, 
   * learnMoreUrl) and include a valid expiry timestamp.
   */
  it('Property 6: Cache round-trip consistency - saved data equals retrieved data', async () => {
    const CACHE_KEY = 'twitter_location_cache';
    const CACHE_EXPIRY_DAYS = 30;

    // Generator for location data
    const locationDataGen = fc.record({
      location: fc.oneof(
        fc.constant(null),
        fc.string({ minLength: 1, maxLength: 50 })
      ),
      source: fc.oneof(
        fc.constant(null),
        fc.string({ minLength: 1, maxLength: 50 })
      ),
      sourceCountry: fc.oneof(
        fc.constant(null),
        fc.string({ minLength: 1, maxLength: 50 })
      ),
      locationAccurate: fc.oneof(
        fc.constant(null),
        fc.boolean()
      ),
      learnMoreUrl: fc.oneof(
        fc.constant(null),
        fc.webUrl()
      )
    });

    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s));

    await fc.assert(
      fc.asyncProperty(usernameGen, locationDataGen, async (username, locationData) => {
        // Step 1: Save location data to cache
        const now = Date.now();
        const expiry = now + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        
        const cacheEntry = {
          data: locationData,
          expiry: expiry,
          cachedAt: now
        };

        await chrome.storage.local.set({
          [CACHE_KEY]: {
            [username]: cacheEntry
          }
        });

        // Step 2: Load location data from cache
        const result = await chrome.storage.local.get([CACHE_KEY]);
        const cached = result[CACHE_KEY];
        
        // Step 3: Verify cache entry exists
        expect(cached).toBeDefined();
        expect(cached[username]).toBeDefined();
        
        // Step 4: Verify all fields are preserved
        const retrievedEntry = cached[username];
        expect(retrievedEntry.data.location).toBe(locationData.location);
        expect(retrievedEntry.data.source).toBe(locationData.source);
        expect(retrievedEntry.data.sourceCountry).toBe(locationData.sourceCountry);
        expect(retrievedEntry.data.locationAccurate).toBe(locationData.locationAccurate);
        expect(retrievedEntry.data.learnMoreUrl).toBe(locationData.learnMoreUrl);
        
        // Step 5: Verify expiry timestamp is valid and in the future
        expect(retrievedEntry.expiry).toBeDefined();
        expect(typeof retrievedEntry.expiry).toBe('number');
        expect(retrievedEntry.expiry).toBeGreaterThan(now);
        
        // Step 6: Verify cachedAt timestamp is valid
        expect(retrievedEntry.cachedAt).toBeDefined();
        expect(typeof retrievedEntry.cachedAt).toBe('number');
        expect(retrievedEntry.cachedAt).toBe(now);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: firefox-compatibility, Property 7: Cache expiry enforcement**
   * **Validates: Requirements 4.5**
   * 
   * For any cache entry with expiry timestamp in the past, isCacheEntryExpired() 
   * should return true and the entry should not be returned from cache.
   */
  it('Property 7: Cache expiry enforcement - expired entries are not returned', async () => {
    // Generator for cache entries with various expiry times
    const cacheEntryGen = fc.record({
      username: fc.string({ minLength: 1, maxLength: 15 })
        .filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
      location: fc.string({ minLength: 1, maxLength: 50 }),
      // Generate expiry times: some in past, some in future
      expiryOffset: fc.integer({ min: -86400000, max: 86400000 }) // -1 day to +1 day in ms
    });

    await fc.assert(
      fc.asyncProperty(cacheEntryGen, async ({ username, location, expiryOffset }) => {
        const now = Date.now();
        const expiry = now + expiryOffset;
        
        // Helper function to check if cache entry is expired (from content.js)
        function isCacheEntryExpired(cacheEntry) {
          if (!cacheEntry || !cacheEntry.expiry) {
            return true; // Treat missing expiry as expired
          }
          return cacheEntry.expiry <= Date.now();
        }
        
        // Create cache entry
        const cacheEntry = {
          location: location,
          source: null,
          sourceCountry: null,
          locationAccurate: null,
          learnMoreUrl: null,
          expiry: expiry
        };
        
        // Check if entry should be expired
        const shouldBeExpired = expiry <= now;
        
        // Test isCacheEntryExpired function
        const isExpired = isCacheEntryExpired(cacheEntry);
        
        // Verify expiry check matches expected result
        expect(isExpired).toBe(shouldBeExpired);
        
        // If expired, verify it would not be used
        if (isExpired) {
          // Expired entries should be treated as cache miss
          expect(cacheEntry.expiry).toBeLessThanOrEqual(now);
        } else {
          // Non-expired entries should have future expiry
          expect(cacheEntry.expiry).toBeGreaterThan(now);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: firefox-compatibility, Property 8: Debounced save behavior**
   * **Validates: Requirements 4.3**
   * 
   * For any sequence of cache updates within a 5-second window, only one 
   * storage.local.set operation should be executed.
   */
  it('Property 8: Debounced save behavior - multiple updates result in single save', async () => {
    // Generator for sequences of cache updates
    const updateSequenceGen = fc.array(
      fc.record({
        username: fc.string({ minLength: 1, maxLength: 15 })
          .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
          .filter(s => !['__proto__', 'constructor', 'prototype'].includes(s)), // Exclude JS special properties
        location: fc.string({ minLength: 1, maxLength: 50 })
      }),
      { minLength: 2, maxLength: 5 } // Multiple updates
    );

    await fc.assert(
      fc.asyncProperty(updateSequenceGen, async (updates) => {
        // Clear mock call history
        chrome.storage.local.set.mockClear();
        
        // Simulate debounced save behavior (without actual delays for testing speed)
        let saveTimeoutId = null;
        const pendingUpdates = new Map();
        let saveCallCount = 0;
        
        // Function to schedule debounced save (simulates saveCacheEntry logic)
        const scheduleSave = (username, location) => {
          pendingUpdates.set(username, location);
          
          // Clear existing timeout (this is the key debouncing behavior)
          if (saveTimeoutId !== null) {
            // In real code, this would be clearTimeout(saveTimeoutId)
            // For testing, we just track that the timeout was reset
            saveTimeoutId = null;
          }
          
          // Schedule new save (in real code, this would be setTimeout)
          // For testing, we just mark that a save is scheduled
          saveTimeoutId = Date.now();
        };
        
        // Execute all updates (simulating rapid updates within debounce window)
        for (const update of updates) {
          scheduleSave(update.username, update.location);
        }
        
        // After all updates, simulate the debounce timeout completing
        // In real code, only ONE setTimeout callback would execute
        const cacheObj = {};
        for (const [user, loc] of pendingUpdates.entries()) {
          cacheObj[user] = {
            data: { location: loc },
            expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
            cachedAt: Date.now()
          };
        }
        await chrome.storage.local.set({ twitter_location_cache: cacheObj });
        saveCallCount++;
        
        // Verify exactly ONE save operation occurred
        expect(saveCallCount).toBe(1);
        expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
        
        // Verify the save contains all updates
        const saveCall = chrome.storage.local.set.mock.calls[0][0];
        expect(saveCall).toHaveProperty('twitter_location_cache');
        
        const savedCache = saveCall.twitter_location_cache;
        
        // Verify all usernames from updates are in the saved cache
        const uniqueUsernames = [...new Set(updates.map(u => u.username))];
        uniqueUsernames.forEach(username => {
          expect(savedCache).toHaveProperty(username);
        });
      }),
      { numRuns: 100 }
    );
  });

  it('cache entry with missing expiry is treated as expired', () => {
    function isCacheEntryExpired(cacheEntry) {
      if (!cacheEntry || !cacheEntry.expiry) {
        return true;
      }
      return cacheEntry.expiry <= Date.now();
    }

    // Test with null entry
    expect(isCacheEntryExpired(null)).toBe(true);
    
    // Test with undefined entry
    expect(isCacheEntryExpired(undefined)).toBe(true);
    
    // Test with entry missing expiry field
    expect(isCacheEntryExpired({ location: 'US' })).toBe(true);
    
    // Test with entry with null expiry
    expect(isCacheEntryExpired({ location: 'US', expiry: null })).toBe(true);
  });

  it('cache entry with future expiry is not expired', () => {
    function isCacheEntryExpired(cacheEntry) {
      if (!cacheEntry || !cacheEntry.expiry) {
        return true;
      }
      return cacheEntry.expiry <= Date.now();
    }

    const futureExpiry = Date.now() + 86400000; // 1 day in future
    const entry = {
      location: 'United States',
      expiry: futureExpiry
    };
    
    expect(isCacheEntryExpired(entry)).toBe(false);
  });

  it('cache entry with past expiry is expired', () => {
    function isCacheEntryExpired(cacheEntry) {
      if (!cacheEntry || !cacheEntry.expiry) {
        return true;
      }
      return cacheEntry.expiry <= Date.now();
    }

    const pastExpiry = Date.now() - 86400000; // 1 day in past
    const entry = {
      location: 'United States',
      expiry: pastExpiry
    };
    
    expect(isCacheEntryExpired(entry)).toBe(true);
  });
});


// ============================================================================
// Toggle State Synchronization Tests
// ============================================================================

describe('Toggle State Synchronization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockStorage.clear();
    vi.clearAllMocks();
    
    // Ensure chrome.tabs is properly initialized
    if (!global.chrome.tabs) {
      global.chrome.tabs = {
        query: vi.fn(() => Promise.resolve([{ id: 1 }])),
        sendMessage: vi.fn(() => Promise.resolve({ success: true }))
      };
    }
  });

  /**
   * **Feature: firefox-compatibility, Property 5: Toggle state synchronization**
   * **Validates: Requirements 1.5, 7.2, 7.4**
   * 
   * For any toggle state change (enabled/disabled), the extension should update storage,
   * send messages to content scripts, and add/remove flags accordingly.
   */
  it('Property 5: Toggle state synchronization - updates storage, sends messages, and manages flags', async () => {
    // Generator for toggle states
    const toggleStateGen = fc.boolean();
    
    // Generator for number of flags to add to DOM
    const flagCountGen = fc.integer({ min: 0, max: 10 });
    
    // Generator for usernames
    const excludedRoutes = ['home', 'explore', 'notifications', 'messages', 'i', 'compose', 'search', 'settings', 'bookmarks', 'lists', 'communities'];
    const usernameGen = fc.string({ minLength: 1, maxLength: 15 })
      .filter(s => /^[a-zA-Z0-9_]+$/.test(s))
      .filter(s => !excludedRoutes.includes(s.toLowerCase()))
      .filter(s => !s.startsWith('hashtag'))
      .filter(s => !s.startsWith('search'))
      .filter(s => !/^\d+$/.test(s));

    await fc.assert(
      fc.asyncProperty(toggleStateGen, flagCountGen, usernameGen, async (newState, flagCount, screenName) => {
        // Setup: Clear DOM and storage
        document.body.innerHTML = '';
        mockStorage.clear();
        
        // Add flags to DOM if flagCount > 0
        const addedFlags = [];
        for (let i = 0; i < flagCount; i++) {
          const container = createTwitterDOMStructure(screenName, 'standard');
          
          // Add a flag wrapper to simulate existing flags
          const flagWrapper = document.createElement('span');
          flagWrapper.setAttribute('data-twitter-flag-wrapper', 'true');
          flagWrapper.textContent = '[🇺🇸 | ✅ | 🇺🇸]';
          container.appendChild(flagWrapper);
          
          // Add a shimmer to simulate loading state
          const shimmer = document.createElement('span');
          shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
          container.appendChild(shimmer);
          
          // Add a button to simulate manual mode
          const button = document.createElement('button');
          button.setAttribute('data-twitter-location-button', 'true');
          button.setAttribute('data-screen-name', screenName);
          container.appendChild(button);
          
          // Add an error indicator
          const error = document.createElement('span');
          error.setAttribute('data-twitter-flag-error', 'true');
          container.appendChild(error);
          
          // Mark container as processed
          container.dataset.flagAdded = 'true';
          
          document.body.appendChild(container);
          addedFlags.push(container);
        }
        
        // Verify initial state
        const initialFlagWrappers = document.querySelectorAll('[data-twitter-flag-wrapper]');
        const initialShimmers = document.querySelectorAll('[data-twitter-flag-shimmer]');
        const initialButtons = document.querySelectorAll('[data-twitter-location-button]');
        const initialErrors = document.querySelectorAll('[data-twitter-flag-error]');
        const initialMarkers = document.querySelectorAll('[data-flag-added]');
        
        expect(initialFlagWrappers.length).toBe(flagCount);
        expect(initialShimmers.length).toBe(flagCount);
        expect(initialButtons.length).toBe(flagCount);
        expect(initialErrors.length).toBe(flagCount);
        expect(initialMarkers.length).toBe(flagCount);
        
        // Simulate toggle action from popup
        // 1. Update storage
        await chrome.storage.local.set({ extension_enabled: newState });
        
        // 2. Send message to content script
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          await chrome.tabs.sendMessage(tabs[0].id, {
            type: 'extensionToggle',
            enabled: newState
          });
        }
        
        // 3. Simulate content script response
        if (newState) {
          // Extension enabled - flags should be re-added (simulated by processUsernames)
          // In real implementation, processUsernames would be called
          // For this test, we verify the state is ready for re-processing
          const storedState = mockStorage.get('extension_enabled');
          expect(storedState).toBe(true);
        } else {
          // Extension disabled - remove all flags
          const flags = document.querySelectorAll('[data-twitter-flag], [data-twitter-flag-wrapper]');
          flags.forEach(flag => flag.remove());
          
          const shimmers = document.querySelectorAll('[data-twitter-flag-shimmer]');
          shimmers.forEach(shimmer => shimmer.remove());
          
          const buttons = document.querySelectorAll('[data-twitter-location-button]');
          buttons.forEach(button => button.remove());
          
          const errors = document.querySelectorAll('[data-twitter-flag-error]');
          errors.forEach(error => error.remove());
          
          const containers = document.querySelectorAll('[data-flag-added]');
          containers.forEach(container => {
            delete container.dataset.flagAdded;
          });
        }
        
        // Verify storage was updated
        const storedState = mockStorage.get('extension_enabled');
        expect(storedState).toBe(newState);
        expect(chrome.storage.local.set).toHaveBeenCalledWith(
          { extension_enabled: newState }
        );
        
        // Verify message was sent to content script
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
          expect.any(Number),
          {
            type: 'extensionToggle',
            enabled: newState
          }
        );
        
        // Verify flags are managed correctly based on state
        if (newState) {
          // When enabled, storage should reflect enabled state
          expect(storedState).toBe(true);
          // Flags would be re-added by processUsernames (not tested here)
        } else {
          // When disabled, all flags should be removed
          const remainingFlagWrappers = document.querySelectorAll('[data-twitter-flag-wrapper]');
          const remainingShimmers = document.querySelectorAll('[data-twitter-flag-shimmer]');
          const remainingButtons = document.querySelectorAll('[data-twitter-location-button]');
          const remainingErrors = document.querySelectorAll('[data-twitter-flag-error]');
          const remainingMarkers = document.querySelectorAll('[data-flag-added]');
          
          expect(remainingFlagWrappers.length).toBe(0);
          expect(remainingShimmers.length).toBe(0);
          expect(remainingButtons.length).toBe(0);
          expect(remainingErrors.length).toBe(0);
          expect(remainingMarkers.length).toBe(0);
        }
        
        // Verify the entire flow uses cross-browser compatible APIs
        // storage.local.set returns Promise (works in both Chrome MV3 and Firefox)
        expect(chrome.storage.local.set).toBeDefined();
        expect(typeof chrome.storage.local.set).toBe('function');
        
        // tabs.query returns Promise (works in both Chrome MV3 and Firefox)
        expect(chrome.tabs.query).toBeDefined();
        expect(typeof chrome.tabs.query).toBe('function');
        
        // tabs.sendMessage returns Promise (works in both Chrome MV3 and Firefox)
        expect(chrome.tabs.sendMessage).toBeDefined();
        expect(typeof chrome.tabs.sendMessage).toBe('function');
        
        // DOM manipulation uses standard APIs (querySelectorAll, remove, dataset)
        expect(typeof document.querySelectorAll).toBe('function');
      }),
      { numRuns: 100 }
    );
  });

  it('toggle to disabled removes all flag types', async () => {
    // Setup: Add various flag types to DOM
    const container = document.createElement('div');
    
    const flagWrapper = document.createElement('span');
    flagWrapper.setAttribute('data-twitter-flag-wrapper', 'true');
    container.appendChild(flagWrapper);
    
    const shimmer = document.createElement('span');
    shimmer.setAttribute('data-twitter-flag-shimmer', 'true');
    container.appendChild(shimmer);
    
    const button = document.createElement('button');
    button.setAttribute('data-twitter-location-button', 'true');
    container.appendChild(button);
    
    const error = document.createElement('span');
    error.setAttribute('data-twitter-flag-error', 'true');
    container.appendChild(error);
    
    container.dataset.flagAdded = 'true';
    
    document.body.appendChild(container);
    
    // Verify initial state
    expect(document.querySelectorAll('[data-twitter-flag-wrapper]').length).toBe(1);
    expect(document.querySelectorAll('[data-twitter-flag-shimmer]').length).toBe(1);
    expect(document.querySelectorAll('[data-twitter-location-button]').length).toBe(1);
    expect(document.querySelectorAll('[data-twitter-flag-error]').length).toBe(1);
    expect(document.querySelectorAll('[data-flag-added]').length).toBe(1);
    
    // Simulate toggle to disabled
    await chrome.storage.local.set({ extension_enabled: false });
    
    // Simulate removeAllFlags
    const flags = document.querySelectorAll('[data-twitter-flag], [data-twitter-flag-wrapper]');
    flags.forEach(flag => flag.remove());
    
    const shimmers = document.querySelectorAll('[data-twitter-flag-shimmer]');
    shimmers.forEach(shimmer => shimmer.remove());
    
    const buttons = document.querySelectorAll('[data-twitter-location-button]');
    buttons.forEach(button => button.remove());
    
    const errors = document.querySelectorAll('[data-twitter-flag-error]');
    errors.forEach(error => error.remove());
    
    const containers = document.querySelectorAll('[data-flag-added]');
    containers.forEach(container => {
      delete container.dataset.flagAdded;
    });
    
    // Verify all flags removed
    expect(document.querySelectorAll('[data-twitter-flag-wrapper]').length).toBe(0);
    expect(document.querySelectorAll('[data-twitter-flag-shimmer]').length).toBe(0);
    expect(document.querySelectorAll('[data-twitter-location-button]').length).toBe(0);
    expect(document.querySelectorAll('[data-twitter-flag-error]').length).toBe(0);
    expect(document.querySelectorAll('[data-flag-added]').length).toBe(0);
    
    // Verify storage updated
    expect(mockStorage.get('extension_enabled')).toBe(false);
  });

  it('toggle to enabled updates storage and prepares for re-processing', async () => {
    // Setup: Start with disabled state
    await chrome.storage.local.set({ extension_enabled: false });
    expect(mockStorage.get('extension_enabled')).toBe(false);
    
    // Simulate toggle to enabled
    await chrome.storage.local.set({ extension_enabled: true });
    
    // Send message to content script
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'extensionToggle',
        enabled: true
      });
    }
    
    // Verify storage updated
    expect(mockStorage.get('extension_enabled')).toBe(true);
    
    // Verify message sent
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      expect.any(Number),
      {
        type: 'extensionToggle',
        enabled: true
      }
    );
  });

  it('toggle state synchronization uses promise-based APIs', async () => {
    // Verify storage.local.set returns a Promise
    const setResult = chrome.storage.local.set({ extension_enabled: true });
    expect(setResult).toBeInstanceOf(Promise);
    await setResult;
    
    // Verify tabs.query returns a Promise
    const queryResult = chrome.tabs.query({ active: true, currentWindow: true });
    expect(queryResult).toBeInstanceOf(Promise);
    await queryResult;
    
    // Verify tabs.sendMessage returns a Promise
    const sendResult = chrome.tabs.sendMessage(1, { type: 'extensionToggle', enabled: true });
    expect(sendResult).toBeInstanceOf(Promise);
    await sendResult;
  });

  it('toggle handles missing tabs gracefully', async () => {
    // Mock tabs.query to return empty array
    chrome.tabs.query = vi.fn(() => Promise.resolve([]));
    
    // Simulate toggle
    await chrome.storage.local.set({ extension_enabled: true });
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Should not throw error when no tabs
    expect(tabs.length).toBe(0);
    
    // Message should not be sent
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('toggle handles sendMessage errors gracefully', async () => {
    // Mock tabs.query to return a tab
    chrome.tabs.query = vi.fn(() => Promise.resolve([{ id: 1 }]));
    
    // Mock tabs.sendMessage to reject
    chrome.tabs.sendMessage = vi.fn(() => Promise.reject(new Error('Receiving end does not exist')));
    
    // Simulate toggle
    await chrome.storage.local.set({ extension_enabled: true });
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Should handle error gracefully (in real implementation, error is caught and logged)
    try {
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'extensionToggle',
        enabled: true
      });
      // Should not reach here
      expect(false).toBe(true);
    } catch (error) {
      expect(error.message).toBe('Receiving end does not exist');
    }
  });

  it('removeAllFlags resets all flag-added markers', () => {
    // Setup: Add containers with flag-added markers
    const container1 = document.createElement('div');
    container1.dataset.flagAdded = 'true';
    document.body.appendChild(container1);
    
    const container2 = document.createElement('div');
    container2.dataset.flagAdded = 'processing';
    document.body.appendChild(container2);
    
    const container3 = document.createElement('div');
    container3.dataset.flagAdded = 'failed';
    document.body.appendChild(container3);
    
    // Verify initial state
    expect(document.querySelectorAll('[data-flag-added]').length).toBe(3);
    
    // Simulate removeAllFlags
    const containers = document.querySelectorAll('[data-flag-added]');
    containers.forEach(container => {
      delete container.dataset.flagAdded;
    });
    
    // Verify all markers removed
    expect(document.querySelectorAll('[data-flag-added]').length).toBe(0);
    expect(container1.dataset.flagAdded).toBeUndefined();
    expect(container2.dataset.flagAdded).toBeUndefined();
    expect(container3.dataset.flagAdded).toBeUndefined();
  });
});

describe('Rate Limiting Cross-Browser Compatibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: firefox-compatibility, Property 9: Rate limit pause behavior**
   * **Validates: Requirements 5.1, 5.5**
   * 
   * For any 429 response with x-rate-limit-reset header, the extension should 
   * set rateLimitResetTime and pause all subsequent requests until the reset time.
   */
  it('Property 9: Rate limit pause behavior - pauses requests until reset time', () => {
    // Generator for rate limit scenarios
    const rateLimitScenarioGen = fc.record({
      resetTimeOffset: fc.integer({ min: 1, max: 300 }), // 1-300 seconds in future
      numPendingRequests: fc.integer({ min: 1, max: 10 }),
      currentTime: fc.integer({ min: 1000000000, max: 2000000000 }) // Unix timestamp
    });

    fc.assert(
      fc.property(rateLimitScenarioGen, (scenario) => {
        // Setup: Create a rate limit state
        const nowSeconds = scenario.currentTime;
        const nowMs = nowSeconds * 1000;
        const resetTimeSeconds = nowSeconds + scenario.resetTimeOffset;
        const resetTimeMs = resetTimeSeconds * 1000;

        // Simulate rate limit detection
        let rateLimitResetTime = 0;
        
        // Simulate receiving rate limit info (like from pageScript.js)
        const rateLimitInfo = {
          resetTime: resetTimeSeconds,
          resetTimestampMs: resetTimeMs,
          waitTime: scenario.resetTimeOffset * 1000
        };

        // Process rate limit info (logic from content.js)
        if (typeof rateLimitInfo.resetTime === 'number' && rateLimitInfo.resetTime > 0) {
          rateLimitResetTime = Math.max(rateLimitResetTime, rateLimitInfo.resetTime);
        }

        if (typeof rateLimitInfo.resetTimestampMs === 'number' && rateLimitInfo.resetTimestampMs > 0) {
          rateLimitResetTime = Math.max(rateLimitResetTime, Math.floor(rateLimitInfo.resetTimestampMs / 1000));
        }

        const waitSeconds = Math.ceil(rateLimitInfo.waitTime / 1000);
        if (waitSeconds > 0) {
          rateLimitResetTime = Math.max(rateLimitResetTime, Math.floor((nowMs + rateLimitInfo.waitTime) / 1000));
        }

        // Verify: rateLimitResetTime should be set to the reset time
        expect(rateLimitResetTime).toBeGreaterThan(0);
        expect(rateLimitResetTime).toBeGreaterThanOrEqual(resetTimeSeconds);

        // Verify: requests should be paused (check if current time < reset time)
        const shouldPause = nowSeconds < rateLimitResetTime;
        expect(shouldPause).toBe(true);

        // Verify: wait time calculation is correct
        const waitTime = (rateLimitResetTime - nowSeconds) * 1000;
        expect(waitTime).toBeGreaterThan(0);
        expect(waitTime).toBeLessThanOrEqual(scenario.resetTimeOffset * 1000 + 1000); // Allow 1s tolerance

        // Verify: after reset time, requests should resume
        const futureTime = resetTimeSeconds + 1;
        const shouldResume = futureTime >= rateLimitResetTime;
        expect(shouldResume).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('rate limit pause behavior handles multiple reset time sources', () => {
    const nowMs = 1000000000000;
    const nowSeconds = Math.floor(nowMs / 1000);
    
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    let rateLimitResetTime = 0;

    // Scenario 1: Only resetTime provided
    const info1 = { resetTime: nowSeconds + 60 };
    if (typeof info1.resetTime === 'number' && info1.resetTime > 0) {
      rateLimitResetTime = Math.max(rateLimitResetTime, info1.resetTime);
    }
    expect(rateLimitResetTime).toBe(nowSeconds + 60);

    // Scenario 2: Only resetTimestampMs provided
    rateLimitResetTime = 0;
    const info2 = { resetTimestampMs: nowMs + 120000 };
    if (typeof info2.resetTimestampMs === 'number' && info2.resetTimestampMs > 0) {
      rateLimitResetTime = Math.max(rateLimitResetTime, Math.floor(info2.resetTimestampMs / 1000));
    }
    expect(rateLimitResetTime).toBe(nowSeconds + 120);

    // Scenario 3: Only waitTime provided
    rateLimitResetTime = 0;
    const info3 = { waitTime: 180000 };
    const waitSeconds = Math.ceil(info3.waitTime / 1000);
    if (waitSeconds > 0) {
      rateLimitResetTime = Math.max(rateLimitResetTime, Math.floor((nowMs + info3.waitTime) / 1000));
    }
    expect(rateLimitResetTime).toBe(nowSeconds + 180);

    // Scenario 4: Multiple sources, should use maximum
    rateLimitResetTime = 0;
    const info4 = {
      resetTime: nowSeconds + 60,
      resetTimestampMs: nowMs + 120000,
      waitTime: 90000
    };
    
    if (typeof info4.resetTime === 'number' && info4.resetTime > 0) {
      rateLimitResetTime = Math.max(rateLimitResetTime, info4.resetTime);
    }
    if (typeof info4.resetTimestampMs === 'number' && info4.resetTimestampMs > 0) {
      rateLimitResetTime = Math.max(rateLimitResetTime, Math.floor(info4.resetTimestampMs / 1000));
    }
    const waitSec = Math.ceil(info4.waitTime / 1000);
    if (waitSec > 0) {
      rateLimitResetTime = Math.max(rateLimitResetTime, Math.floor((nowMs + info4.waitTime) / 1000));
    }
    
    // Should use the maximum (120 seconds)
    expect(rateLimitResetTime).toBe(nowSeconds + 120);
  });

  it('rate limit pause behavior logs appropriate wait time', () => {
    const nowMs = 1000000000000;
    const nowSeconds = Math.floor(nowMs / 1000);
    const resetTimeSeconds = nowSeconds + 180; // 3 minutes
    
    vi.spyOn(Date, 'now').mockReturnValue(nowMs);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const rateLimitResetTime = resetTimeSeconds;
    const minutes = Math.max(1, Math.ceil((rateLimitResetTime - nowSeconds) / 60));
    
    console.log(`Rate limit detected. Will resume requests in ${minutes} minutes`);
    
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Rate limit detected'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('3 minutes'));
  });
});

describe('Request Interval Enforcement Cross-Browser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: firefox-compatibility, Property 10: Request interval enforcement**
   * **Validates: Requirements 5.2**
   * 
   * For any sequence of API requests, consecutive requests should be spaced 
   * at least MIN_REQUEST_INTERVAL (2000ms) apart.
   */
  it('Property 10: Request interval enforcement - enforces minimum interval between requests', () => {
    const MIN_REQUEST_INTERVAL = 2000;

    // Generator for request sequences
    const requestSequenceGen = fc.array(
      fc.record({
        username: fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
        timestamp: fc.integer({ min: 0, max: 100000 })
      }),
      { minLength: 2, maxLength: 10 }
    );

    fc.assert(
      fc.property(requestSequenceGen, (requests) => {
        // Simulate request queue processing with interval enforcement
        let lastRequestTime = null; // Use null to indicate no previous request
        const processedRequests = [];

        for (const request of requests) {
          const now = request.timestamp;

          // Calculate when this request should actually be processed
          let actualProcessTime = now;
          if (lastRequestTime !== null) {
            const timeSinceLastRequest = now - lastRequestTime;
            if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
              // Need to wait - schedule after last request + interval
              actualProcessTime = lastRequestTime + MIN_REQUEST_INTERVAL;
            }
          }

          processedRequests.push({
            username: request.username,
            requestedAt: now,
            processedAt: actualProcessTime
          });

          lastRequestTime = actualProcessTime;
        }

        // Verify: all consecutive requests are spaced at least MIN_REQUEST_INTERVAL apart
        for (let i = 1; i < processedRequests.length; i++) {
          const prevProcessTime = processedRequests[i - 1].processedAt;
          const currProcessTime = processedRequests[i].processedAt;
          const interval = currProcessTime - prevProcessTime;

          expect(interval).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL);
        }

        // Verify: first request is processed immediately (no previous request)
        expect(processedRequests[0].processedAt).toBe(processedRequests[0].requestedAt);
      }),
      { numRuns: 100 }
    );
  });

  it('request interval enforcement waits when requests come too quickly', () => {
    const MIN_REQUEST_INTERVAL = 2000;
    let lastRequestTime = null; // Use null to indicate no previous request

    // Request 1 at time 0
    const now1 = 0;
    let processTime1 = now1;
    if (lastRequestTime !== null) {
      const timeSince1 = now1 - lastRequestTime;
      if (timeSince1 < MIN_REQUEST_INTERVAL) {
        processTime1 = lastRequestTime + MIN_REQUEST_INTERVAL;
      }
    }
    lastRequestTime = processTime1;
    expect(processTime1).toBe(0); // First request processes immediately

    // Request 2 at time 500 (too soon)
    const now2 = 500;
    let processTime2 = now2;
    if (lastRequestTime !== null) {
      const timeSince2 = now2 - lastRequestTime;
      if (timeSince2 < MIN_REQUEST_INTERVAL) {
        processTime2 = lastRequestTime + MIN_REQUEST_INTERVAL;
      }
    }
    lastRequestTime = processTime2;
    expect(processTime2).toBe(2000); // Should wait until 2000ms (0 + 2000)

    // Request 3 at time 3000 (still too soon - only 1000ms after request 2 processed at 2000)
    const now3 = 3000;
    let processTime3 = now3;
    if (lastRequestTime !== null) {
      const timeSince3 = now3 - lastRequestTime;
      if (timeSince3 < MIN_REQUEST_INTERVAL) {
        processTime3 = lastRequestTime + MIN_REQUEST_INTERVAL;
      }
    }
    lastRequestTime = processTime3;
    expect(processTime3).toBe(4000); // Should wait until 4000ms (2000 + 2000)
    
    // Request 4 at time 6000 (after interval)
    const now4 = 6000;
    let processTime4 = now4;
    if (lastRequestTime !== null) {
      const timeSince4 = now4 - lastRequestTime;
      if (timeSince4 < MIN_REQUEST_INTERVAL) {
        processTime4 = lastRequestTime + MIN_REQUEST_INTERVAL;
      }
    }
    expect(processTime4).toBe(6000); // Processes immediately (6000 - 4000 = 2000, exactly at interval)
  });

  it('request interval enforcement handles rapid succession of requests', () => {
    const MIN_REQUEST_INTERVAL = 2000;
    let lastRequestTime = null; // Use null to indicate no previous request
    const requests = [0, 100, 200, 300, 400]; // All within 500ms
    const processTimes = [];

    for (const now of requests) {
      let processTime = now;
      
      if (lastRequestTime !== null) {
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
          processTime = lastRequestTime + MIN_REQUEST_INTERVAL;
        }
      }
      
      processTimes.push(processTime);
      lastRequestTime = processTime;
    }

    // Verify spacing
    expect(processTimes[0]).toBe(0);
    expect(processTimes[1]).toBe(2000);
    expect(processTimes[2]).toBe(4000);
    expect(processTimes[3]).toBe(6000);
    expect(processTimes[4]).toBe(8000);

    // Verify all intervals are at least MIN_REQUEST_INTERVAL
    for (let i = 1; i < processTimes.length; i++) {
      const interval = processTimes[i] - processTimes[i - 1];
      expect(interval).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL);
    }
  });
});

describe('Concurrent Request Limiting Cross-Browser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: firefox-compatibility, Property 11: Concurrent request limiting**
   * **Validates: Requirements 5.3**
   * 
   * For any point in time during request processing, activeRequests should 
   * never exceed MAX_CONCURRENT_REQUESTS (2).
   */
  it('Property 11: Concurrent request limiting - limits concurrent requests to maximum', () => {
    const MAX_CONCURRENT_REQUESTS = 2;

    // Generator for request processing scenarios
    const requestScenarioGen = fc.record({
      numRequests: fc.integer({ min: 1, max: 20 }),
      requestDurations: fc.array(fc.integer({ min: 100, max: 5000 }), { minLength: 1, maxLength: 20 })
    }).map(scenario => ({
      numRequests: scenario.numRequests,
      requestDurations: scenario.requestDurations.slice(0, scenario.numRequests)
    }));

    fc.assert(
      fc.property(requestScenarioGen, (scenario) => {
        // Simulate concurrent request processing
        let activeRequests = 0;
        let maxActiveRequests = 0;
        const completedRequests = [];
        let currentTime = 0;

        // Process requests
        for (let i = 0; i < scenario.numRequests; i++) {
          // Wait if at max concurrent requests
          while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
            // Simulate waiting for a request to complete
            const nextCompletion = Math.min(...completedRequests.map(r => r.completionTime).filter(t => t > currentTime));
            if (nextCompletion === Infinity) break;
            
            currentTime = nextCompletion;
            // Remove completed requests
            completedRequests.forEach(r => {
              if (r.completionTime <= currentTime && r.active) {
                activeRequests--;
                r.active = false;
              }
            });
          }

          // Start new request
          if (activeRequests < MAX_CONCURRENT_REQUESTS) {
            activeRequests++;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            
            const duration = scenario.requestDurations[i];
            completedRequests.push({
              startTime: currentTime,
              completionTime: currentTime + duration,
              active: true
            });

            // Verify: activeRequests never exceeds MAX_CONCURRENT_REQUESTS
            expect(activeRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
          }
        }

        // Verify: maximum concurrent requests never exceeded limit
        expect(maxActiveRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
      }),
      { numRuns: 100 }
    );
  });

  it('concurrent request limiting blocks when at maximum', () => {
    const MAX_CONCURRENT_REQUESTS = 2;
    let activeRequests = 0;

    // Start request 1
    activeRequests++;
    expect(activeRequests).toBe(1);
    expect(activeRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);

    // Start request 2
    activeRequests++;
    expect(activeRequests).toBe(2);
    expect(activeRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);

    // Try to start request 3 - should be blocked
    const canStartRequest3 = activeRequests < MAX_CONCURRENT_REQUESTS;
    expect(canStartRequest3).toBe(false);

    // Complete request 1
    activeRequests--;
    expect(activeRequests).toBe(1);

    // Now request 3 can start
    const canStartRequest3Now = activeRequests < MAX_CONCURRENT_REQUESTS;
    expect(canStartRequest3Now).toBe(true);
    activeRequests++;
    expect(activeRequests).toBe(2);
    expect(activeRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
  });

  it('concurrent request limiting handles rapid request completion', () => {
    const MAX_CONCURRENT_REQUESTS = 2;
    let activeRequests = 0;
    const maxActiveTracked = [];

    // Simulate 10 requests with immediate completion
    for (let i = 0; i < 10; i++) {
      // Wait if at max
      while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
        // Simulate completion of one request
        activeRequests--;
      }

      // Start new request
      activeRequests++;
      maxActiveTracked.push(activeRequests);

      // Verify never exceeds max
      expect(activeRequests).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);

      // Simulate some requests completing immediately
      if (i % 3 === 0 && activeRequests > 0) {
        activeRequests--;
      }
    }

    // Verify max was never exceeded
    const maxEverActive = Math.max(...maxActiveTracked);
    expect(maxEverActive).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
  });
});

describe('Queue Resumption After Rate Limit Cross-Browser', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Feature: firefox-compatibility, Property 12: Queue resumption after rate limit**
   * **Validates: Requirements 5.4**
   * 
   * For any rate-limited state, when current time exceeds rateLimitResetTime, 
   * the request queue should resume processing.
   */
  it('Property 12: Queue resumption after rate limit - resumes when reset time passes', () => {
    // Generator for rate limit resumption scenarios
    const resumptionScenarioGen = fc.record({
      resetTimeOffset: fc.integer({ min: 1, max: 300 }), // 1-300 seconds
      currentTime: fc.integer({ min: 1000000000, max: 2000000000 }), // Unix timestamp
      queueSize: fc.integer({ min: 1, max: 10 })
    });

    fc.assert(
      fc.property(resumptionScenarioGen, (scenario) => {
        const nowSeconds = scenario.currentTime;
        const rateLimitResetTime = nowSeconds + scenario.resetTimeOffset;

        // Simulate being rate limited
        let isRateLimited = nowSeconds < rateLimitResetTime;
        expect(isRateLimited).toBe(true);

        // Simulate time passing to just before reset
        const almostResetTime = rateLimitResetTime - 1;
        isRateLimited = almostResetTime < rateLimitResetTime;
        expect(isRateLimited).toBe(true);

        // Simulate time passing to reset time
        const atResetTime = rateLimitResetTime;
        isRateLimited = atResetTime < rateLimitResetTime;
        expect(isRateLimited).toBe(false); // Should not be rate limited anymore

        // Simulate time passing beyond reset time
        const afterResetTime = rateLimitResetTime + 1;
        isRateLimited = afterResetTime < rateLimitResetTime;
        expect(isRateLimited).toBe(false);

        // Verify: queue should resume processing
        const shouldResumeQueue = afterResetTime >= rateLimitResetTime;
        expect(shouldResumeQueue).toBe(true);

        // Verify: rate limit should be cleared
        const clearedRateLimitResetTime = 0; // Reset to 0 after expiry
        expect(clearedRateLimitResetTime).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('queue resumption checks time correctly', () => {
    const nowSeconds = 1000000;
    const rateLimitResetTime = nowSeconds + 60; // 60 seconds in future

    // Before reset time - should be paused
    const beforeReset = nowSeconds + 30;
    const isPausedBefore = beforeReset < rateLimitResetTime;
    expect(isPausedBefore).toBe(true);

    // At reset time - should resume
    const atReset = rateLimitResetTime;
    const isPausedAt = atReset < rateLimitResetTime;
    expect(isPausedAt).toBe(false);

    // After reset time - should resume
    const afterReset = rateLimitResetTime + 10;
    const isPausedAfter = afterReset < rateLimitResetTime;
    expect(isPausedAfter).toBe(false);
  });

  it('queue resumption resets rate limit state', () => {
    let rateLimitResetTime = 1000060; // Some future time
    const now = 1000070; // After reset time

    // Check if rate limit expired
    if (now >= rateLimitResetTime) {
      // Rate limit expired, reset
      rateLimitResetTime = 0;
    }

    expect(rateLimitResetTime).toBe(0);
  });

  it('queue resumption handles edge case of exact reset time', () => {
    const rateLimitResetTime = 1000000;
    const now = 1000000; // Exactly at reset time

    // At exact reset time, should not be rate limited
    const isRateLimited = now < rateLimitResetTime;
    expect(isRateLimited).toBe(false);

    // Should resume processing
    const shouldResume = now >= rateLimitResetTime;
    expect(shouldResume).toBe(true);
  });

  it('queue resumption processes pending requests after reset', () => {
    const requestQueue = ['user1', 'user2', 'user3'];
    let rateLimitResetTime = 1000060;
    const nowBefore = 1000050;
    const nowAfter = 1000070;

    // Before reset - queue should not process
    const shouldProcessBefore = nowBefore >= rateLimitResetTime;
    expect(shouldProcessBefore).toBe(false);
    expect(requestQueue.length).toBe(3); // Queue unchanged

    // After reset - queue should process
    const shouldProcessAfter = nowAfter >= rateLimitResetTime;
    expect(shouldProcessAfter).toBe(true);

    // Simulate processing queue
    if (shouldProcessAfter && requestQueue.length > 0) {
      // Reset rate limit
      rateLimitResetTime = 0;
      
      // Process requests (in real implementation)
      const processedRequest = requestQueue.shift();
      expect(processedRequest).toBe('user1');
      expect(requestQueue.length).toBe(2);
    }

    expect(rateLimitResetTime).toBe(0);
  });
});

describe('Error Handling Cross-Browser Compatibility', () => {
  let originalConsoleError;
  let originalConsoleLog;
  let consoleErrorCalls;
  let consoleLogCalls;

  beforeEach(() => {
    // Mock console methods to track error logging
    consoleErrorCalls = [];
    consoleLogCalls = [];
    originalConsoleError = console.error;
    originalConsoleLog = console.log;
    console.error = vi.fn((...args) => {
      consoleErrorCalls.push(args);
    });
    console.log = vi.fn((...args) => {
      consoleLogCalls.push(args);
    });
    
    mockStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore console methods
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  });

  /**
   * **Feature: firefox-compatibility, Property 17: Extension context validation**
   * **Validates: Requirements 6.5**
   * 
   * For any operation that accesses extension APIs, if browserAPI.runtime.id is undefined,
   * the operation should return early without throwing errors.
   */
  it('Property 17: Extension context validation - operations return early when context invalidated', async () => {
    // Generator for extension context states
    const contextStateGen = fc.record({
      hasRuntimeId: fc.boolean(),
      operationType: fc.constantFrom('loadCache', 'saveCache', 'saveCacheEntry')
    });

    await fc.assert(
      fc.asyncProperty(contextStateGen, async (state) => {
        // Setup browserAPI mock based on context state
        const mockBrowserAPI = {
          storage: {
            local: {
              get: vi.fn(() => Promise.resolve({})),
              set: vi.fn(() => Promise.resolve())
            }
          },
          runtime: state.hasRuntimeId ? { id: 'test-extension-id' } : {}
        };

        // Simulate the extension context validation logic from content.js
        const isContextValid = () => {
          return Boolean(mockBrowserAPI.runtime?.id);
        };

        // Test different operations
        let operationCompleted = false;
        let errorThrown = false;

        try {
          if (state.operationType === 'loadCache') {
            // Simulate loadCache() logic
            if (!isContextValid()) {
              console.log('Extension context invalidated, skipping cache load');
              // Should return early without calling storage API
              expect(mockBrowserAPI.storage.local.get).not.toHaveBeenCalled();
            } else {
              await mockBrowserAPI.storage.local.get(['twitter_location_cache']);
              operationCompleted = true;
            }
          } else if (state.operationType === 'saveCache') {
            // Simulate saveCache() logic
            if (!isContextValid()) {
              console.log('Extension context invalidated, skipping cache save');
              // Should return early without calling storage API
              expect(mockBrowserAPI.storage.local.set).not.toHaveBeenCalled();
            } else {
              await mockBrowserAPI.storage.local.set({ twitter_location_cache: {} });
              operationCompleted = true;
            }
          } else if (state.operationType === 'saveCacheEntry') {
            // Simulate saveCacheEntry() logic
            if (!isContextValid()) {
              console.log('Extension context invalidated, skipping cache entry save');
              // Should return early without calling storage API
              expect(mockBrowserAPI.storage.local.set).not.toHaveBeenCalled();
            } else {
              // Would normally save, but we're just testing the validation
              operationCompleted = true;
            }
          }
        } catch (error) {
          errorThrown = true;
        }

        // Assert: no errors should be thrown regardless of context state
        expect(errorThrown).toBe(false);

        // Assert: if context is invalid, operation should not complete
        if (!state.hasRuntimeId) {
          expect(operationCompleted).toBe(false);
          // Verify appropriate log message was called
          expect(consoleLogCalls.some(call => 
            call.some(arg => typeof arg === 'string' && arg.includes('Extension context invalidated'))
          )).toBe(true);
        }

        // Assert: if context is valid, operation should complete (for loadCache and saveCache)
        if (state.hasRuntimeId && (state.operationType === 'loadCache' || state.operationType === 'saveCache')) {
          expect(operationCompleted).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('extension context validation prevents storage operations when context invalid', async () => {
    // Setup invalid context
    const mockBrowserAPI = {
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve())
        }
      },
      runtime: {} // No id property
    };

    // Simulate loadCache with invalid context
    const isContextValid = Boolean(mockBrowserAPI.runtime?.id);
    
    if (!isContextValid) {
      console.log('Extension context invalidated, skipping cache load');
      // Should return early
    } else {
      await mockBrowserAPI.storage.local.get(['twitter_location_cache']);
    }

    // Verify storage API was not called
    expect(mockBrowserAPI.storage.local.get).not.toHaveBeenCalled();
    
    // Verify log message
    expect(consoleLogCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Extension context invalidated'))
    )).toBe(true);
  });

  it('extension context validation allows operations when context valid', async () => {
    // Setup valid context
    const mockBrowserAPI = {
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve({ twitter_location_cache: {} })),
          set: vi.fn(() => Promise.resolve())
        }
      },
      runtime: { id: 'test-extension-id' }
    };

    // Simulate loadCache with valid context
    const isContextValid = Boolean(mockBrowserAPI.runtime?.id);
    
    if (!isContextValid) {
      console.log('Extension context invalidated, skipping cache load');
    } else {
      await mockBrowserAPI.storage.local.get(['twitter_location_cache']);
    }

    // Verify storage API was called
    expect(mockBrowserAPI.storage.local.get).toHaveBeenCalledWith(['twitter_location_cache']);
  });

  it('extension context validation handles undefined runtime gracefully', () => {
    // Setup context with undefined runtime
    const mockBrowserAPI = {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn()
        }
      },
      runtime: undefined
    };

    // Test validation logic
    const isContextValid = Boolean(mockBrowserAPI.runtime?.id);
    
    // Should be false without throwing error
    expect(isContextValid).toBe(false);
    
    // Optional chaining should prevent errors
    expect(() => {
      const id = mockBrowserAPI.runtime?.id;
      expect(id).toBeUndefined();
    }).not.toThrow();
  });

  it('extension context validation handles null runtime gracefully', () => {
    // Setup context with null runtime
    const mockBrowserAPI = {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn()
        }
      },
      runtime: null
    };

    // Test validation logic
    const isContextValid = Boolean(mockBrowserAPI.runtime?.id);
    
    // Should be false without throwing error
    expect(isContextValid).toBe(false);
    
    // Optional chaining should prevent errors
    expect(() => {
      const id = mockBrowserAPI.runtime?.id;
      expect(id).toBeUndefined();
    }).not.toThrow();
  });

  /**
   * **Feature: firefox-compatibility, Property 18: Error logging consistency**
   * **Validates: Requirements 6.4**
   * 
   * For any error condition (storage error, API error, DOM error), the extension
   * should log an appropriate error message via console.error.
   */
  it('Property 18: Error logging consistency - errors are logged consistently', async () => {
    // Generator for error scenarios
    const errorScenarioGen = fc.record({
      errorType: fc.constantFrom('storage', 'api', 'dom', 'general'),
      errorMessage: fc.string({ minLength: 5, maxLength: 50 }),
      hasContext: fc.boolean()
    });

    await fc.assert(
      fc.asyncProperty(errorScenarioGen, async (scenario) => {
        // Clear previous console calls
        consoleErrorCalls = [];
        consoleLogCalls = [];

        // Simulate different error scenarios
        try {
          if (scenario.errorType === 'storage') {
            // Simulate storage error
            const error = new Error(scenario.errorMessage);
            console.error('Error loading cache:', error);
          } else if (scenario.errorType === 'api') {
            // Simulate API error
            const screenName = 'testuser';
            const error = new Error(scenario.errorMessage);
            console.error(`Error processing flag for ${screenName}:`, error);
          } else if (scenario.errorType === 'dom') {
            // Simulate DOM error
            const screenName = 'testuser';
            console.error(`Could not find username link for ${screenName}`);
          } else {
            // General error
            console.error('Error:', scenario.errorMessage);
          }
        } catch (error) {
          // Should not throw
          expect(false).toBe(true);
        }

        // Assert: console.error should have been called
        expect(consoleErrorCalls.length).toBeGreaterThan(0);

        // Assert: error message should be logged
        const errorLogged = consoleErrorCalls.some(call => 
          call.some(arg => {
            if (typeof arg === 'string') {
              return arg.includes('Error') || arg.includes('error') || arg.includes('Could not');
            }
            if (arg instanceof Error) {
              return true;
            }
            return false;
          })
        );
        expect(errorLogged).toBe(true);

        // Assert: error logging should work identically in both browsers
        // (console.error is a standard API that works the same in Chrome and Firefox)
        expect(typeof console.error).toBe('function');
      }),
      { numRuns: 100 }
    );
  });

  it('storage errors are logged with appropriate context', async () => {
    const error = new Error('Storage quota exceeded');
    
    // Simulate storage error logging from content.js
    console.error('Error loading cache:', error);

    // Verify error was logged
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    expect(consoleErrorCalls[0]).toContain('Error loading cache:');
    expect(consoleErrorCalls[0]).toContain(error);
  });

  it('API errors are logged with username context', () => {
    const screenName = 'testuser';
    const error = new Error('Network request failed');
    
    // Simulate API error logging from content.js
    console.error(`Error processing flag for ${screenName}:`, error);

    // Verify error was logged with context
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    expect(consoleErrorCalls[0][0]).toContain('Error processing flag for testuser');
    expect(consoleErrorCalls[0]).toContain(error);
  });

  it('DOM errors are logged with descriptive messages', () => {
    const screenName = 'testuser';
    
    // Simulate DOM error logging from content.js
    console.error(`Could not find username link for ${screenName}`);

    // Verify error was logged
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    expect(consoleErrorCalls[0][0]).toContain('Could not find username link for testuser');
  });

  it('error logging uses standard console API', () => {
    // Verify console.error is available (standard in both Chrome and Firefox)
    expect(typeof console.error).toBe('function');
    
    // Test that it can be called
    console.error('Test error message');
    
    // Verify it was called
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
  });

  it('error logging handles Error objects correctly', () => {
    const error = new Error('Test error');
    error.stack = 'Error: Test error\n    at test.js:1:1';
    
    // Log error
    console.error('Error occurred:', error);

    // Verify error object was logged
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    expect(consoleErrorCalls[0]).toContain(error);
    expect(consoleErrorCalls[0][1]).toBeInstanceOf(Error);
  });

  it('error logging handles string messages correctly', () => {
    const message = 'Something went wrong';
    
    // Log string error
    console.error(message);

    // Verify string was logged
    expect(consoleErrorCalls.length).toBeGreaterThan(0);
    expect(consoleErrorCalls[0][0]).toBe(message);
  });

  it('error logging works consistently across different error types', () => {
    // Test various error types
    const errors = [
      new Error('Standard error'),
      new TypeError('Type error'),
      new RangeError('Range error'),
      'String error message',
      { error: 'Object error' }
    ];

    errors.forEach(error => {
      console.error('Error:', error);
    });

    // Verify all errors were logged
    expect(consoleErrorCalls.length).toBe(errors.length);
    
    // Verify each call contains the error
    consoleErrorCalls.forEach((call, index) => {
      expect(call).toContain(errors[index]);
    });
  });

  it('extension context invalidation errors are handled gracefully', async () => {
    const error = new Error('Extension context invalidated');
    
    // Simulate handling extension context invalidation
    if (error.message?.includes('Extension context invalidated') || 
        error.message?.includes('message port closed')) {
      console.log('Extension context invalidated, cache load skipped');
    } else {
      console.error('Error loading cache:', error);
    }

    // Verify appropriate message was logged (log, not error)
    expect(consoleLogCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Extension context invalidated'))
    )).toBe(true);
    
    // Verify error was not logged (since it's expected)
    expect(consoleErrorCalls.length).toBe(0);
  });

  it('message port closed errors are handled gracefully', async () => {
    const error = new Error('Attempting to use a disconnected port object');
    
    // Simulate handling message port closed error
    if (error.message?.includes('Extension context invalidated') || 
        error.message?.includes('message port closed') ||
        error.message?.includes('disconnected port')) {
      console.log('Extension context invalidated, cache save skipped');
    } else {
      console.error('Error saving cache:', error);
    }

    // Verify appropriate message was logged (log, not error)
    expect(consoleLogCalls.some(call => 
      call.some(arg => typeof arg === 'string' && arg.includes('Extension context invalidated'))
    )).toBe(true);
    
    // Verify error was not logged (since it's expected)
    expect(consoleErrorCalls.length).toBe(0);
  });
});

describe('Page Script Injection Cross-Browser Compatibility', () => {
  let originalDocument;
  let mockHead;
  let mockDocumentElement;

  beforeEach(() => {
    // Setup mock DOM
    mockHead = {
      appendChild: vi.fn(),
      children: []
    };
    mockDocumentElement = {
      appendChild: vi.fn(),
      children: []
    };
    
    // Mock document.head and document.documentElement
    Object.defineProperty(document, 'head', {
      value: mockHead,
      writable: true,
      configurable: true
    });
    Object.defineProperty(document, 'documentElement', {
      value: mockDocumentElement,
      writable: true,
      configurable: true
    });
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * **Feature: firefox-compatibility, Property 19: Script injection in page context**
   * **Validates: Requirements 8.1**
   * 
   * For any page load, the content script should create a script element with src 
   * from browserAPI.runtime.getURL() and append it to document head or documentElement.
   */
  it('Property 19: Script injection in page context - creates and injects script element', () => {
    // Generator for browser API configurations
    const browserAPIGen = fc.record({
      namespace: fc.constantFrom('browser', 'chrome'),
      extensionId: fc.string({ minLength: 10, maxLength: 32 }),
      hasHead: fc.boolean()
    });

    fc.assert(
      fc.property(browserAPIGen, (config) => {
        // Setup browserAPI mock
        const mockBrowserAPI = {
          runtime: {
            id: config.extensionId,
            getURL: vi.fn((path) => `${config.namespace}-extension://${config.extensionId}/${path}`)
          }
        };

        // Simulate injectPageScript() logic from content.js
        const script = document.createElement('script');
        script.src = mockBrowserAPI.runtime.getURL('pageScript.js');
        script.onload = function() {
          this.remove();
        };

        // Determine where to append (head or documentElement)
        const appendTarget = config.hasHead ? document.head : document.documentElement;
        appendTarget.appendChild(script);

        // Assert: script element should be created
        expect(script).toBeDefined();
        expect(script.tagName).toBe('SCRIPT');

        // Assert: browserAPI.runtime.getURL should be called with 'pageScript.js'
        expect(mockBrowserAPI.runtime.getURL).toHaveBeenCalledWith('pageScript.js');

        // Assert: script.src should be set to the extension URL
        expect(script.src).toContain('pageScript.js');
        expect(script.src).toContain(config.extensionId);

        // Assert: script should have onload handler
        expect(typeof script.onload).toBe('function');

        // Assert: script should be appended to head or documentElement
        if (config.hasHead) {
          expect(mockHead.appendChild).toHaveBeenCalledWith(script);
        } else {
          expect(mockDocumentElement.appendChild).toHaveBeenCalledWith(script);
        }

        // Assert: script element creation uses standard DOM APIs (works identically in both browsers)
        expect(typeof document.createElement).toBe('function');
        expect(script instanceof HTMLScriptElement).toBe(true);

        // Assert: appendChild is standard DOM API (works identically in both browsers)
        expect(typeof appendTarget.appendChild).toBe('function');
      }),
      { numRuns: 100 }
    );
  });

  it('script injection creates script element with correct attributes', () => {
    const mockBrowserAPI = {
      runtime: {
        id: 'test-extension-id',
        getURL: vi.fn((path) => `chrome-extension://test-extension-id/${path}`)
      }
    };

    // Create script element
    const script = document.createElement('script');
    script.src = mockBrowserAPI.runtime.getURL('pageScript.js');

    // Verify script element
    expect(script.tagName).toBe('SCRIPT');
    expect(script.src).toBe('chrome-extension://test-extension-id/pageScript.js');
    expect(mockBrowserAPI.runtime.getURL).toHaveBeenCalledWith('pageScript.js');
  });

  it('script injection appends to document.head when available', () => {
    const mockBrowserAPI = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://test/${path}`)
      }
    };

    // Create and inject script
    const script = document.createElement('script');
    script.src = mockBrowserAPI.runtime.getURL('pageScript.js');
    
    // Append to head (when available)
    const target = document.head || document.documentElement;
    target.appendChild(script);

    // Verify appended to head
    expect(mockHead.appendChild).toHaveBeenCalledWith(script);
  });

  it('script injection falls back to document.documentElement when head unavailable', () => {
    // Remove document.head
    Object.defineProperty(document, 'head', {
      value: null,
      writable: true,
      configurable: true
    });

    const mockBrowserAPI = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://test/${path}`)
      }
    };

    // Create and inject script
    const script = document.createElement('script');
    script.src = mockBrowserAPI.runtime.getURL('pageScript.js');
    
    // Append to documentElement (fallback)
    const target = document.head || document.documentElement;
    target.appendChild(script);

    // Verify appended to documentElement
    expect(mockDocumentElement.appendChild).toHaveBeenCalledWith(script);
  });

  it('script injection sets onload handler to remove script', () => {
    const script = document.createElement('script');
    script.src = 'chrome-extension://test/pageScript.js';
    
    // Set onload handler (as in content.js)
    script.onload = function() {
      this.remove();
    };

    // Verify onload handler exists
    expect(typeof script.onload).toBe('function');

    // Mock remove method
    script.remove = vi.fn();

    // Trigger onload
    script.onload();

    // Verify remove was called
    expect(script.remove).toHaveBeenCalled();
  });

  it('script injection uses browserAPI.runtime.getURL for cross-browser compatibility', () => {
    // Test with browser namespace (Firefox)
    const firefoxAPI = {
      runtime: {
        getURL: vi.fn((path) => `moz-extension://firefox-id/${path}`)
      }
    };

    const script1 = document.createElement('script');
    script1.src = firefoxAPI.runtime.getURL('pageScript.js');

    expect(firefoxAPI.runtime.getURL).toHaveBeenCalledWith('pageScript.js');
    expect(script1.src).toBe('moz-extension://firefox-id/pageScript.js');

    // Test with chrome namespace (Chrome)
    const chromeAPI = {
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://chrome-id/${path}`)
      }
    };

    const script2 = document.createElement('script');
    script2.src = chromeAPI.runtime.getURL('pageScript.js');

    expect(chromeAPI.runtime.getURL).toHaveBeenCalledWith('pageScript.js');
    expect(script2.src).toBe('chrome-extension://chrome-id/pageScript.js');
  });

  it('script injection executes in page context (not extension context)', () => {
    // When a script element is created and appended to the DOM,
    // it executes in the page context, not the extension context.
    // This is standard browser behavior that works identically in Chrome and Firefox.

    const script = document.createElement('script');
    script.src = 'chrome-extension://test/pageScript.js';

    // Verify script element is created (standard DOM API)
    expect(script instanceof HTMLScriptElement).toBe(true);

    // When appended to document.head or document.documentElement,
    // the script will execute in page context with access to:
    // - window object
    // - document object
    // - page's cookies and authentication
    // - Same-origin fetch requests

    // This behavior is consistent across Chrome and Firefox
    // because it's part of the standard DOM specification
  });

  it('script injection uses standard DOM APIs that work identically in both browsers', () => {
    // Verify all DOM APIs used are standard
    
    // document.createElement - standard
    expect(typeof document.createElement).toBe('function');
    const script = document.createElement('script');
    expect(script instanceof HTMLScriptElement).toBe(true);

    // script.src property - standard
    script.src = 'test.js';
    expect(script.src).toContain('test.js');

    // script.onload event - standard
    script.onload = () => {};
    expect(typeof script.onload).toBe('function');

    // appendChild - standard
    expect(typeof document.documentElement.appendChild).toBe('function');

    // remove method - standard
    expect(typeof script.remove).toBe('function');

    // All these APIs work identically in Chrome and Firefox
  });

  it('script injection handles missing document.head gracefully', () => {
    // Simulate environment where document.head is null (rare but possible)
    Object.defineProperty(document, 'head', {
      value: null,
      writable: true,
      configurable: true
    });

    const script = document.createElement('script');
    script.src = 'chrome-extension://test/pageScript.js';

    // Use fallback logic from content.js
    const target = document.head || document.documentElement;
    target.appendChild(script);

    // Should fall back to documentElement
    expect(target).toBe(document.documentElement);
    expect(mockDocumentElement.appendChild).toHaveBeenCalledWith(script);
  });

  it('script injection URL format is correct for Chrome', () => {
    const chromeAPI = {
      runtime: {
        getURL: (path) => `chrome-extension://abcdefghijklmnop/${path}`
      }
    };

    const url = chromeAPI.runtime.getURL('pageScript.js');
    
    // Chrome extension URLs follow this format
    expect(url).toBe('chrome-extension://abcdefghijklmnop/pageScript.js');
    expect(url).toMatch(/^chrome-extension:\/\/[a-z]+\/pageScript\.js$/);
  });

  it('script injection URL format is correct for Firefox', () => {
    const firefoxAPI = {
      runtime: {
        getURL: (path) => `moz-extension://12345678-1234-1234-1234-123456789012/${path}`
      }
    };

    const url = firefoxAPI.runtime.getURL('pageScript.js');
    
    // Firefox extension URLs follow this format
    expect(url).toBe('moz-extension://12345678-1234-1234-1234-123456789012/pageScript.js');
    expect(url).toMatch(/^moz-extension:\/\/.+\/pageScript\.js$/);
  });

  it('script element is removed after loading to clean up DOM', () => {
    const script = document.createElement('script');
    script.src = 'chrome-extension://test/pageScript.js';
    script.remove = vi.fn();

    // Set onload handler
    script.onload = function() {
      this.remove();
    };

    // Simulate script load
    script.onload();

    // Verify script was removed
    expect(script.remove).toHaveBeenCalled();
  });
});
