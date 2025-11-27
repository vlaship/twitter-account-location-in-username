import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import manifest from './manifest.json';

describe('Manifest Firefox Compatibility', () => {
  /**
   * Feature: firefox-compatibility, Property 13: Permission compatibility
   * Validates: Requirements 3.2
   * 
   * For any permission declared in manifest.json, it should be in the set of 
   * cross-browser compatible permissions: ["activeTab", "storage", "tabs"]
   */
  it('Property 13: Permission compatibility - all permissions are cross-browser compatible', () => {
    const compatiblePermissions = new Set(['activeTab', 'storage', 'tabs']);
    
    fc.assert(
      fc.property(
        fc.constantFrom(...manifest.permissions),
        (permission) => {
          // Each permission in the manifest should be in the compatible set
          expect(compatiblePermissions.has(permission)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('manifest has only cross-browser compatible permissions', () => {
    const compatiblePermissions = ['activeTab', 'storage', 'tabs'];
    
    // Verify all permissions are compatible
    manifest.permissions.forEach(permission => {
      expect(compatiblePermissions).toContain(permission);
    });
  });

  /**
   * Feature: firefox-compatibility, Property 14: Content script configuration compatibility
   * Validates: Requirements 3.3
   * 
   * For any content_scripts entry in manifest.json, it should use only fields 
   * supported by both browsers: matches, js, run_at
   */
  it('Property 14: Content script configuration compatibility - uses only compatible fields', () => {
    const compatibleFields = new Set(['matches', 'js', 'run_at']);
    
    fc.assert(
      fc.property(
        fc.constantFrom(...manifest.content_scripts),
        (contentScript) => {
          // Get all keys from the content script entry
          const scriptKeys = Object.keys(contentScript);
          
          // Each key should be in the compatible fields set
          scriptKeys.forEach(key => {
            expect(compatibleFields.has(key)).toBe(true);
          });
          
          // Verify required fields are present
          expect(contentScript).toHaveProperty('matches');
          expect(contentScript).toHaveProperty('js');
          expect(contentScript).toHaveProperty('run_at');
          
          // Verify field types
          expect(Array.isArray(contentScript.matches)).toBe(true);
          expect(Array.isArray(contentScript.js)).toBe(true);
          expect(typeof contentScript.run_at).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('content_scripts use only compatible fields', () => {
    const compatibleFields = ['matches', 'js', 'run_at'];
    
    manifest.content_scripts.forEach(contentScript => {
      const scriptKeys = Object.keys(contentScript);
      
      // All keys should be in compatible fields
      scriptKeys.forEach(key => {
        expect(compatibleFields).toContain(key);
      });
      
      // Verify structure
      expect(Array.isArray(contentScript.matches)).toBe(true);
      expect(Array.isArray(contentScript.js)).toBe(true);
      expect(typeof contentScript.run_at).toBe('string');
    });
  });

  it('manifest_version is 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('has browser_specific_settings for Firefox', () => {
    expect(manifest).toHaveProperty('browser_specific_settings');
    expect(manifest.browser_specific_settings).toHaveProperty('gecko');
    expect(manifest.browser_specific_settings.gecko).toHaveProperty('id');
    expect(manifest.browser_specific_settings.gecko).toHaveProperty('strict_min_version');
  });

  it('Firefox minimum version is 109.0 or higher', () => {
    const minVersion = manifest.browser_specific_settings.gecko.strict_min_version;
    const versionNumber = parseFloat(minVersion);
    expect(versionNumber).toBeGreaterThanOrEqual(109.0);
  });
});
