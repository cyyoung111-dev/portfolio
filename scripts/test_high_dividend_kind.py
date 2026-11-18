"""Isolated candidate validation and correction alerts; no network/writes."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("kind_collect",Path(__file__).with_name("collect-high-dividend-kind.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.rows=[["1","유가","삼성전자","기업가치 제고 계획(자율공시)","2025","12","25.1","13.2"],
                   ["2","유가","SK","기업가치 제고 계획(자율공시)(고배당기업 표시를 위한 재공시)","2025","12","27.6","14.3"]]
    def test_matching_source(self):
        self.assertEqual(mod.validate_candidate_rows(mod.EXPECTED_COLUMNS,self.rows,2025,2),2)
        self.assertEqual(mod.review_candidates(self.rows,2025)["state"],"CANDIDATE_ONLY")
    def test_count_row_identity_and_year(self):
        for i,j,bad in [(1,0,"1"),(1,2,"삼성전자"),(1,4,"2026"),(1,1,"기타")]:
            rows=[r[:] for r in self.rows]
            rows[i][j]=bad
            with self.assertRaises(RuntimeError):
                mod.validate_candidate_rows(mod.EXPECTED_COLUMNS,rows,2025,2)
        with self.assertRaises(RuntimeError):
            mod.validate_candidate_rows(mod.EXPECTED_COLUMNS,self.rows,2025,3)
        with self.assertRaises(RuntimeError):
            mod.validate_candidate_rows(mod.EXPECTED_COLUMNS[:-1],self.rows,2025,2)
    def test_corrected_and_absent_rows(self):
        rows=[r[:] for r in self.rows]
        rows[0][3]="[정정]기업가치 제고 계획(자율공시)"
        self.assertEqual(mod.review_candidates(rows,2025)["changes"][0]["state"],"DISCLOSURE_ROW_CHANGED")
        self.assertEqual(mod.review_candidates(rows[1:],2025)["changes"][0]["state"],"MISSING_FROM_CURRENT_LIST")
        self.assertEqual(mod.review_candidates([],2026)["comparison"],"NO_REVIEW_BASELINE")

if __name__=="__main__":
    unittest.main()
