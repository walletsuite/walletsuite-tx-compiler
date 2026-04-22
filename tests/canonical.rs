//! Byte-exact determinism tests against the pinned canonical fixture set.
//!
//! Every case in `tests/fixtures/canonical.json` declares an input payload
//! and the exact `unsigned_tx`, `tx_hash`, `metadata`, and `review` outputs
//! the compiler must produce for it. Any divergence is a hard failure so
//! the compiler cannot drift silently across versions.

use serde::Deserialize;
use walletsuite_tx_compiler::{compile, review, validate, CompileOptions};

#[derive(Debug, Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    input: serde_json::Value,
    options: Option<OptionsFixture>,
    expected: Expected,
}

#[derive(Debug, Deserialize)]
struct OptionsFixture {
    now: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    unsigned_tx: String,
    tx_hash: String,
    metadata: serde_json::Value,
    review: serde_json::Value,
}

fn load_fixture() -> Fixture {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/canonical.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));
    serde_json::from_str(&raw).expect("failed to parse canonical fixture")
}

#[test]
fn all_cases_match_expected_output() {
    let fixture = load_fixture();
    assert!(!fixture.cases.is_empty(), "fixture file contains no cases");

    for case in fixture.cases {
        let prepared = validate(&case.input)
            .unwrap_or_else(|err| panic!("case {}: validation failed: {err}", case.name));

        let options = case
            .options
            .and_then(|o| o.now)
            .map_or_else(CompileOptions::default, |now| {
                CompileOptions::new().with_now(now)
            });

        let result = compile(&prepared, options)
            .unwrap_or_else(|err| panic!("case {}: compile failed: {err}", case.name));

        let review = review(&prepared)
            .unwrap_or_else(|err| panic!("case {}: review failed: {err}", case.name));

        assert_eq!(
            result.unsigned_tx, case.expected.unsigned_tx,
            "case {}: unsigned_tx mismatch",
            case.name
        );
        assert_eq!(
            result.tx_hash, case.expected.tx_hash,
            "case {}: tx_hash mismatch",
            case.name
        );

        let actual_metadata = serde_json::to_value(&result.metadata).expect("serialize metadata");
        assert_eq!(
            actual_metadata, case.expected.metadata,
            "case {}: metadata mismatch",
            case.name
        );

        let actual_review = serde_json::to_value(&review).expect("serialize review");
        assert_eq!(
            actual_review, case.expected.review,
            "case {}: review mismatch",
            case.name
        );
    }
}
