from pathlib import Path

FIX = Path(__file__).parent / "fixtures"


def fixture_bytes(name: str) -> bytes:
    return (FIX / name).read_bytes()
