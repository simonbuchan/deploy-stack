# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `createEventLogWaiter()` export.

### Changed

- New waiter used by CLI when stdout is not a TTY.
- Fix error message when stack operation fails to say `CREATE`, `UPDATE`, or
  `DELETE` instead of always saying `delete`.

### Removed

## [1.0.1] - 2018-09-19

### Added

- This changelog file!
- Add export for `createTableWaiter` used by CLI.

### Changed

- Build for ECMAScript 2015 instead of 2017, as it is only slightly larger, and
  gives compat back to Node 6.

### Removed

- ECMAScript modules build in `es` - didn't make sense for a node-only package,
  and I haven't tested non-node environments.

## 1.0.0 - 2018-09-18

### Added

- Initial `deployStack()` function, CLI.

[unreleased]: https://github.com/simonbuchan/deploy-stack/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/simonbuchan/deploy-stack/compare/v1.0.0...v1.0.1
