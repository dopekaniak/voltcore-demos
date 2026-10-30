import trimesh

from app.slicecheck import slice_check


def test_a_closed_box_slices_cleanly():
    r = slice_check(trimesh.creation.box(extents=[20, 20, 10]), 0.2)
    assert r["ok"] is True
    assert r["layers"] == 50
    assert r["empty_count"] == 0


def test_two_stacked_boxes_with_a_gap_report_empty_layers():
    a = trimesh.creation.box(extents=[10, 10, 4])
    b = trimesh.creation.box(extents=[10, 10, 4])
    b.apply_translation([0, 0, 6])
    r = slice_check(trimesh.util.concatenate([a, b]), 0.2)
    assert r["ok"] is False
    assert r["empty_count"] >= 9


def test_an_open_mesh_reports_open_contours():
    m = trimesh.creation.box(extents=[10, 10, 10])
    m.update_faces([i for i in range(len(m.faces)) if i not in (0, 1, 4)])
    r = slice_check(m, 0.5)
    assert r["open_count"] > 0
