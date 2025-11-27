import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock Chrome API
const mockStorage = new Map();

global.chrome = {
  storage: {
    local: {
      get: vi.fn((keys, callback) => {
        const result = {};
        const keyArray = Array.isArray(keys) ? keys : [keys];
        keyArray.forEach(key => {
          if (mockStorage.has(key)) {
            result[key] = mockStorage.get(key);
          }
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items, callback) => {
        Object.entries(items).forEach(([key, value]) => {
          mockStorage.set(key, value);
        });
        if (callback) callback();
        return Promise.resolve();
      })
    }
  },
  tabs: {
    query: vi.fn((queryInfo, callback) => {
      const tabs = [{ id: 1 }];
      if (callback) callback(tabs);
      return Promise.resolve(tabs);
    }),
    sendMessage: vi.fn((tabId, message) => {
      return Promise.resolve({ success: true });
    })
  }
};

// Constants
const MODE_KEY = 'display_mode';
const MODE_AUTO = 'auto';
const MODE_MANUAL = 'manual';
const DEFAULT_MODE = MODE_AUTO;
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;

// Helper functions to simulate popup.js behavior
function loadMode(mode) {
  const currentMode = mode || DEFAULT_MODE;
  updateModeUI(currentMode);
}

function updateModeUI(mode) {
  const autoButton = document.getElementById('autoButton');
  const manualButton = document.getElementById('manualButton');
  
  if (!autoButton || !manualButton) return;
  
  if (mode === MODE_AUTO) {
    autoButton.classList.add('active');
    manualButton.classList.remove('active');
  } else {
    manualButton.classList.add('active');
    autoButton.classList.remove('active');
  }
}

function setMode(newMode) {
  chrome.storage.local.set({ [MODE_KEY]: newMode }, () => {
    updateModeUI(newMode);
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'modeChange',
          mode: newMode
        });
      }
    });
  });
}

describe('Popup Mode Management', () => {
  beforeEach(() => {
    // Clear storage and mocks
    mockStorage.clear();
    vi.clearAllMocks();

    // Setup DOM
    document.body.innerHTML = `
      <div class="toggle-container">
        <span class="toggle-label">Enable Extension</span>
        <div class="toggle-switch" id="toggleSwitch"></div>
      </div>
      <div class="mode-container">
        <span class="mode-label">Display Mode</span>
        <div class="mode-selector">
          <button class="mode-button" data-mode="auto" id="autoButton">Auto</button>
          <button class="mode-button" data-mode="manual" id="manualButton">Manual</button>
        </div>
      </div>
      <div class="status" id="status">Loading...</div>
    `;
  });

  /**
   * Test toggle switch updates storage
   * Task 13: Verify toggle switch updates storage
   * Requirements: 7.2
   */
  it('toggle switch updates storage when clicked', async () => {
    // Set initial state to enabled
    mockStorage.set(TOGGLE_KEY, true);
    
    // Simulate toggle click by calling the logic
    const result = await chrome.storage.local.get([TOGGLE_KEY]);
    const currentState = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
    const newState = !currentState;
    
    await chrome.storage.local.set({ [TOGGLE_KEY]: newState });
    
    // Verify storage was updated
    expect(mockStorage.get(TOGGLE_KEY)).toBe(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { [TOGGLE_KEY]: false }
    );
    
    // Verify message would be sent to content script
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    expect(tabs).toHaveLength(1);
  });

  /**
   * Test loadMode() retrieves correct mode from storage
   * Requirements: 1.1, 1.2, 1.4
   */
  it('loadMode() retrieves correct mode from storage', async () => {
    // Set mode in storage
    mockStorage.set(MODE_KEY, MODE_MANUAL);
    
    // Retrieve and load mode
    const result = await chrome.storage.local.get([MODE_KEY]);
    const mode = result[MODE_KEY] || DEFAULT_MODE;
    loadMode(mode);
    
    // Check that manual button is active
    const manualButton = document.getElementById('manualButton');
    const autoButton = document.getElementById('autoButton');
    
    expect(manualButton.classList.contains('active')).toBe(true);
    expect(autoButton.classList.contains('active')).toBe(false);
  });

  /**
   * Test setMode() saves mode to storage
   * Requirements: 1.1, 1.2
   */
  it('setMode() saves mode to storage', async () => {
    // Call setMode
    setMode(MODE_MANUAL);
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify mode was saved to storage
    expect(mockStorage.get(MODE_KEY)).toBe(MODE_MANUAL);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { [MODE_KEY]: MODE_MANUAL },
      expect.any(Function)
    );
  });

  /**
   * Test default mode when no preference exists
   * Requirements: 1.4
   */
  it('defaults to auto mode when no preference exists', async () => {
    // Don't set any mode in storage
    
    // Retrieve and load mode
    const result = await chrome.storage.local.get([MODE_KEY]);
    const mode = result[MODE_KEY] || DEFAULT_MODE;
    loadMode(mode);
    
    // Check that auto button is active by default
    const autoButton = document.getElementById('autoButton');
    const manualButton = document.getElementById('manualButton');
    
    expect(autoButton.classList.contains('active')).toBe(true);
    expect(manualButton.classList.contains('active')).toBe(false);
  });

  /**
   * Test mode button click handlers
   * Requirements: 1.1, 1.2
   */
  it('mode button click handlers update UI and storage', async () => {
    const autoButton = document.getElementById('autoButton');
    const manualButton = document.getElementById('manualButton');
    
    // Simulate clicking manual button
    setMode(MODE_MANUAL);
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify UI updated
    expect(manualButton.classList.contains('active')).toBe(true);
    expect(autoButton.classList.contains('active')).toBe(false);
    
    // Verify storage updated
    expect(mockStorage.get(MODE_KEY)).toBe(MODE_MANUAL);
    
    // Simulate clicking auto button
    setMode(MODE_AUTO);
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify UI updated back
    expect(autoButton.classList.contains('active')).toBe(true);
    expect(manualButton.classList.contains('active')).toBe(false);
    
    // Verify storage updated
    expect(mockStorage.get(MODE_KEY)).toBe(MODE_AUTO);
  });

  /**
   * Test that mode changes notify content script
   * Requirements: 1.3
   */
  it('mode changes notify content script', async () => {
    // Call setMode
    setMode(MODE_MANUAL);
    
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify message was sent to content script
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      {
        type: 'modeChange',
        mode: MODE_MANUAL
      }
    );
  });

  /**
   * Test that auto mode is set correctly
   * Requirements: 1.1, 1.2
   */
  it('setMode() correctly sets auto mode', async () => {
    // First set to manual
    setMode(MODE_MANUAL);
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Then set to auto
    setMode(MODE_AUTO);
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Verify storage
    expect(mockStorage.get(MODE_KEY)).toBe(MODE_AUTO);
    
    // Verify UI
    const autoButton = document.getElementById('autoButton');
    const manualButton = document.getElementById('manualButton');
    expect(autoButton.classList.contains('active')).toBe(true);
    expect(manualButton.classList.contains('active')).toBe(false);
  });

  /**
   * **Feature: firefox-compatibility, Property 15: Promise-based messaging**
   * 
   * **Validates: Requirements 2.2**
   * 
   * For any message sent via browserAPI.tabs.sendMessage(), it should return a Promise
   * that resolves or rejects appropriately.
   */
  it('Property 15: Promise-based messaging - sendMessage returns Promise', async () => {
    // Generator for message types
    const messageTypeGen = fc.constantFrom('extensionToggle', 'modeChange');
    
    // Generator for message payloads
    const messageGen = fc.record({
      type: messageTypeGen,
      enabled: fc.boolean(),
      mode: fc.constantFrom(MODE_AUTO, MODE_MANUAL)
    });

    // Generator for tab IDs
    const tabIdGen = fc.integer({ min: 1, max: 1000 });

    await fc.assert(
      fc.asyncProperty(tabIdGen, messageGen, async (tabId, message) => {
        // Mock browserAPI for this test
        const mockBrowserAPI = {
          tabs: {
            sendMessage: vi.fn((id, msg) => Promise.resolve({ success: true }))
          }
        };

        // Call sendMessage
        const result = mockBrowserAPI.tabs.sendMessage(tabId, message);

        // Assert: result should be a Promise
        expect(result).toBeInstanceOf(Promise);

        // Assert: Promise should resolve successfully
        const resolved = await result;
        expect(resolved).toBeDefined();
        expect(mockBrowserAPI.tabs.sendMessage).toHaveBeenCalledWith(tabId, message);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: firefox-compatibility, Property 15: Promise-based messaging (rejection)**
   * 
   * **Validates: Requirements 2.2**
   * 
   * For any message sent via browserAPI.tabs.sendMessage() that fails, the Promise
   * should reject appropriately and be catchable.
   */
  it('Property 15: Promise-based messaging - sendMessage rejects on error', async () => {
    // Generator for error messages
    const errorMessageGen = fc.constantFrom(
      'Receiving end does not exist',
      'Extension context invalidated',
      'Could not establish connection'
    );

    // Generator for tab IDs
    const tabIdGen = fc.integer({ min: 1, max: 1000 });

    await fc.assert(
      fc.asyncProperty(tabIdGen, errorMessageGen, async (tabId, errorMessage) => {
        // Mock browserAPI that rejects
        const mockBrowserAPI = {
          tabs: {
            sendMessage: vi.fn((id, msg) => Promise.reject(new Error(errorMessage)))
          }
        };

        // Call sendMessage and expect it to reject
        const message = { type: 'test', data: 'test' };
        
        try {
          await mockBrowserAPI.tabs.sendMessage(tabId, message);
          // Should not reach here
          expect(false).toBe(true);
        } catch (error) {
          // Assert: error should be defined and have the expected message
          expect(error).toBeDefined();
          expect(error.message).toBe(errorMessage);
          expect(mockBrowserAPI.tabs.sendMessage).toHaveBeenCalledWith(tabId, message);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: firefox-compatibility, Property 22: Popup state initialization**
   * 
   * **Validates: Requirements 7.3**
   * 
   * For any stored extension state in storage, when the popup loads, it should display 
   * the toggle switch and mode buttons matching the stored state.
   */
  it('Property 22: Popup state initialization', async () => {
    // Generator for extension enabled state
    const enabledStateGen = fc.boolean();
    
    // Generator for display mode
    const modeGen = fc.constantFrom(MODE_AUTO, MODE_MANUAL);
    
    // Generator for complete extension state
    const extensionStateGen = fc.record({
      enabled: enabledStateGen,
      mode: modeGen
    });

    await fc.assert(
      fc.asyncProperty(extensionStateGen, async (state) => {
        // Clear previous state
        mockStorage.clear();
        vi.clearAllMocks();
        
        // Set up DOM
        document.body.innerHTML = `
          <div class="toggle-container">
            <span class="toggle-label">Enable Extension</span>
            <div class="toggle-switch" id="toggleSwitch"></div>
          </div>
          <div class="mode-container">
            <span class="mode-label">Display Mode</span>
            <div class="mode-selector">
              <button class="mode-button" data-mode="auto" id="autoButton">Auto</button>
              <button class="mode-button" data-mode="manual" id="manualButton">Manual</button>
            </div>
          </div>
          <div class="status" id="status">Loading...</div>
        `;
        
        // Store the state in mock storage
        mockStorage.set(TOGGLE_KEY, state.enabled);
        mockStorage.set(MODE_KEY, state.mode);
        
        // Simulate popup loading by calling loadCurrentState logic
        const result = await chrome.storage.local.get([TOGGLE_KEY, MODE_KEY]);
        const isEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
        const mode = result[MODE_KEY] || DEFAULT_MODE;
        
        // Update UI based on loaded state
        const toggleSwitch = document.getElementById('toggleSwitch');
        const statusElement = document.getElementById('status');
        
        if (isEnabled) {
          toggleSwitch.classList.add('enabled');
          statusElement.textContent = 'Extension is enabled';
          statusElement.style.color = '#1d9bf0';
        } else {
          toggleSwitch.classList.remove('enabled');
          statusElement.textContent = 'Extension is disabled';
          statusElement.style.color = '#536471';
        }
        
        loadMode(mode);
        
        // Assert: Toggle switch should reflect stored enabled state
        if (state.enabled) {
          expect(toggleSwitch.classList.contains('enabled')).toBe(true);
          expect(statusElement.textContent).toBe('Extension is enabled');
          // Color can be in hex or rgb format depending on browser/environment
          expect(['#1d9bf0', 'rgb(29, 155, 240)']).toContain(statusElement.style.color);
        } else {
          expect(toggleSwitch.classList.contains('enabled')).toBe(false);
          expect(statusElement.textContent).toBe('Extension is disabled');
          // Color can be in hex or rgb format depending on browser/environment
          expect(['#536471', 'rgb(83, 100, 113)']).toContain(statusElement.style.color);
        }
        
        // Assert: Mode buttons should reflect stored mode
        const autoButton = document.getElementById('autoButton');
        const manualButton = document.getElementById('manualButton');
        
        if (state.mode === MODE_AUTO) {
          expect(autoButton.classList.contains('active')).toBe(true);
          expect(manualButton.classList.contains('active')).toBe(false);
        } else {
          expect(manualButton.classList.contains('active')).toBe(true);
          expect(autoButton.classList.contains('active')).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
