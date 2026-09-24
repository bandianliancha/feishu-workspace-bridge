# Release Guide

## Version release

1. Update `package.json` and `CHANGELOG.md`.
2. Run `npm ci`, `npm run check`, `npm audit --omit=dev` and `npm pack --dry-run`.
3. Commit and push the release changes.
4. Create and push a signed or annotated `vX.Y.Z` tag.

Pushing the tag runs `.github/workflows/release.yml`. The workflow repeats the checks, creates the npm-compatible tarball and attaches it to a GitHub Release.

## npm publication

The package is published as `dsh-plugin-feishu-workspace`. Publishing a new version requires a maintainer account with 2FA enabled:

```bash
npm login
npm publish --access public
```

Before publishing, confirm that the Git tag, package version and changelog version are identical. Never place npm tokens in the repository or local project files.
