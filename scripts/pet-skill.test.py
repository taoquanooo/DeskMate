"""Exercise the downloaded skill from an independent directory with no repo imports."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

from PIL import Image, ImageDraw

SKILL = Path(__file__).resolve().parents[1] / "skills" / "deskmate-create-pet"
ROWS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review", "look-a", "look-b"]
COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]


class OfflinePetSkillTest(unittest.TestCase):
    def test_standalone_assembly_validation_and_packaging(self):
        with tempfile.TemporaryDirectory(prefix="deskmate-skill-") as temporary:
            root = Path(temporary)
            # The user receives only the skill folder, then runs it outside the app repo.
            standalone = root / "downloaded" / "deskmate-create-pet"
            shutil.copytree(SKILL, standalone)
            tool = standalone / "scripts" / "pet_tools.py"
            frames = root / "frames"
            for row, count in zip(ROWS, COUNTS):
                directory = frames / row
                directory.mkdir(parents=True)
                for index in range(count):
                    image = Image.new("RGBA", (192, 208))
                    ImageDraw.Draw(image).ellipse((50 + index, 50, 130 + index, 200), fill=(255, 120, 40, 255))
                    image.save(directory / f"{index + 1:02}.png")

            def run(*args):
                return subprocess.run([sys.executable, "-X", "utf8", str(tool), *map(str, args)], cwd=root, capture_output=True, text=True, encoding="utf-8")

            pet = root / "pet"
            assembled = run("assemble", frames, pet, "--id", "skill-test", "--name", "Test pet", "--description", "Test fixture")
            self.assertEqual(assembled.returncode, 0, assembled.stderr)
            self.assertEqual(json.loads(assembled.stdout)["spriteVersionNumber"], 2)
            with Image.open(pet / "spritesheet.webp") as atlas:
                self.assertEqual(atlas.size, (1536, 2288))
            self.assertEqual(run("validate", pet).returncode, 0)
            package = root / "pet.zip"
            packed = run("pack", pet, package)
            self.assertEqual(packed.returncode, 0, packed.stderr)
            self.assertLessEqual(package.stat().st_size, 25 * 1024 * 1024)
            with zipfile.ZipFile(package) as archive:
                self.assertEqual(set(archive.namelist()), {"pet.json", "spritesheet.webp"})
                archive.extractall(root / "installed")
            self.assertEqual(run("validate", root / "installed").returncode, 0)
            # A corrupt manifest produces a clear failure rather than an attribute traceback.
            (pet / "pet.json").write_text("[]", encoding="utf-8")
            bad = run("validate", pet)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn("清单必须是 JSON 对象", bad.stderr)


if __name__ == "__main__":
    unittest.main()
