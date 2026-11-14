import math
from datetime import date

from pipeline.http import is_xls, is_zip, looks_like_html
from pipeline.sources import s1_cm_delivery as s1
from pipeline.sources import s4_pr_zip
from pipeline.sources import s5_s6_participant as s5
from pipeline.sources.base import parse_dmy_dash, parse_dmy_mon, tokens
from pipeline.sources.s12_to_s15 import s12_parse, s13_parse, s14_parse

from .conftest import fixture_bytes

D = date(2026, 11, 13)


def test_date_tokens():
    t = tokens(D)
    assert t == {"DDMMYYYY": "13112026", "DDMMYY": "131126", "YYYYMMDD": "20261113", "DD-Mon-YYYY": "13-Nov-2026"}


def test_date_parsing_all_formats():
    assert parse_dmy_mon("13-Nov-2026") == D
    assert parse_dmy_mon("13-NOV-2026") == D
    assert parse_dmy_mon("13 NOV 2026") == D
    assert parse_dmy_dash("13-11-2026") == D
    assert parse_dmy_mon("garbage") is None


def test_s1_parse_header_strip_nulls_lakh_and_sme_drop():
    p = s1.parse(fixture_bytes("s1_sample.csv"), D)
    assert p.header == s1.EXPECTED_HEADER  # header stripped of the space after every comma
    df = p.data
    assert "SM" not in set(df["series"])  # SME dropped at parse time
    assert set(df["series"]) == {"EQ", "BE"}
    be = df[df["sym"] == "21STCENMGM"].iloc[0]
    assert math.isnan(be["delivQty"]) and math.isnan(be["delivPct"])  # '-' is null, never 0
    eq = df[df["sym"] == "20MICRONS"].iloc[0]
    assert eq["delivQty"] == 20990 and eq["delivPct"] == 56.32 and eq["turnoverLacs"] == 68.90
    assert eq["date"] == "2026-11-13"
    # only row-count validation fails on a 6-row sample
    assert all("row count" in e or "EQ rows" in e for e in p.errors)


def test_s1_date_mismatch_detected():
    p = s1.parse(fixture_bytes("s1_sample.csv"), date(2026, 11, 12))
    assert any(e.startswith("DATE1 mismatch") for e in p.errors)


def test_s1_header_mismatch():
    bad = fixture_bytes("s1_sample.csv").replace(b"DELIV_PER", b"DELIVERY_PERCENT")
    assert s1.parse(bad, D).errors[0].startswith("schema_mismatch")


def test_html_and_magic_detection():
    assert looks_like_html(b"<!DOCTYPE html><html>Access Denied</html>")
    assert is_zip(b"PK\x03\x04abc") and not is_zip(b"<html>")
    assert is_xls(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest")


def test_purpose_classification():
    c = s4_pr_zip.classify_purpose
    assert c("INTDIV - RS 2 PER SH") == "DIVIDEND"
    assert c("FVSPLT FRM RS 10 TO RE 1") == "SPLIT"
    assert c("BONUS 3:2") == "BONUS"
    assert c("BUY BACK") == "BUYBACK"
    assert c("RIGHTS ISSUE") == "RIGHTS"
    assert c("INTEREST PAYMENT") == "OTHER"
    assert c("BONUS 1:1 AND INTDIV") == "BONUS"


def test_mcap_padded_fields_stripped():
    import csv
    import io

    text = fixture_bytes("mcap_sample.csv").decode()
    h, rows = s4_pr_zip._read(text)
    assert h == s4_pr_zip.MCAP_HEADER  # trailing spaces in the header stripped
    assert rows[0][3].strip() == "20 MICRONS LTD"
    assert list(csv.reader(io.StringIO(text)))[1][7].strip() == "35286502"


def test_bc_and_bh_headers():
    h, rows = s4_pr_zip._read(fixture_bytes("bc_sample.csv").decode())
    assert h == s4_pr_zip.BC_HEADER and len(rows) == 9
    h, _ = s4_pr_zip._read(fixture_bytes("bh_sample.csv").decode())
    assert h == s4_pr_zip.BH_HEADER


def test_participant_title_line_skipped():
    p = s5._parse(fixture_bytes("oi_sample.csv"), D)
    assert p.ok, p.errors
    assert p.header == s5.HEADER and p.rows == 5
    assert "Participant wise Open Interest" in p.notes[0]


def test_hl52_disclaimer_lines_skipped():
    p = s13_parse(fixture_bytes("hl52_sample.csv"), D)
    assert p.header == ["SYMBOL", "SERIES", "Adjusted_52_Week_High", "52_Week_High_Date", "Adjusted_52_Week_Low",
                        "52_Week_Low_DT"]
    df = p.data
    assert math.isnan(df.iloc[0]["hi"])  # '-' -> null
    assert df.iloc[1]["hi"] == 237.4  # padded value stripped


def test_indices_close_negative_fraction():
    p = s12_parse(fixture_bytes("ind_close_sample.csv"), D)
    row = p.data[p.data["Index Name"] == "Nifty 50"].iloc[0]
    assert row["Change(%)"] == -0.61


def test_ban_list_with_and_without_names():
    assert s14_parse(fixture_bytes("ban_sample.csv"), D).data == ["KAYNES"]
    p = s14_parse(fixture_bytes("ban_nil.csv"), date(2025, 11, 4))
    assert p.ok and p.data == []
