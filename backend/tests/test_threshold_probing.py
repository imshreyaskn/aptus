# backend/tests/test_threshold_probing.py
from backend.app.graph.nodes import coverage_check_node
from backend.app.graph.state import InterviewState

def test_passing_threshold_advances_topic():
    state: InterviewState = {
        'session_id': 'test_sess_01',
        'candidate_id': 'c1',
        'candidate_name': 'shreyas',
        'role': 'AI/ML Engineer',
        'topics_planned': [
            {'topic': 'Distributed Training Systems'},
            {'topic': 'Loss Functions & Optimization'}
        ],
        'current_topic_index': 0,
        'current_difficulty': 'mid',
        'topic_coverage': {
            'Distributed Training Systems': {'attempts': 1, 'covered': True, 'max_depth': 'adequate'},
            'Loss Functions & Optimization': {'attempts': 0, 'covered': False, 'max_depth': 'none'}
        },
        'questions_count': 1,
        'turn_decision': {'intent': 'answer', 'action': 'advance'},
        'qa_history': []
    }
    
    res = coverage_check_node(state)
    assert res['is_completed'] is False
    assert res['current_topic_index'] == 1
    assert res['is_probing_same_topic'] is False

def test_failing_first_attempt_probes_same_topic():
    state: InterviewState = {
        'session_id': 'test_sess_02',
        'candidate_id': 'c1',
        'candidate_name': 'shreyas',
        'role': 'AI/ML Engineer',
        'topics_planned': [
            {'topic': 'Distributed Training Systems'},
            {'topic': 'Loss Functions & Optimization'}
        ],
        'current_topic_index': 0,
        'current_difficulty': 'mid',
        'topic_coverage': {
            'Distributed Training Systems': {'attempts': 1, 'covered': False, 'max_depth': 'insufficient'},
            'Loss Functions & Optimization': {'attempts': 0, 'covered': False, 'max_depth': 'none'}
        },
        'questions_count': 1,
        'turn_decision': {'intent': 'answer', 'action': 'advance'},
        'qa_history': []
    }
    
    res = coverage_check_node(state)
    assert res['is_completed'] is False
    assert res['current_topic_index'] == 0
    assert res['is_probing_same_topic'] is True

def test_failing_second_attempt_advances_to_next_topic():
    state: InterviewState = {
        'session_id': 'test_sess_03',
        'candidate_id': 'c1',
        'candidate_name': 'shreyas',
        'role': 'AI/ML Engineer',
        'topics_planned': [
            {'topic': 'Distributed Training Systems'},
            {'topic': 'Loss Functions & Optimization'}
        ],
        'current_topic_index': 0,
        'current_difficulty': 'mid',
        'topic_coverage': {
            'Distributed Training Systems': {'attempts': 2, 'covered': False, 'max_depth': 'insufficient'},
            'Loss Functions & Optimization': {'attempts': 0, 'covered': False, 'max_depth': 'none'}
        },
        'questions_count': 2,
        'turn_decision': {'intent': 'answer', 'action': 'advance'},
        'qa_history': []
    }
    
    res = coverage_check_node(state)
    assert res['is_completed'] is False
    assert res['current_topic_index'] == 1
    assert res['is_probing_same_topic'] is False

if __name__ == '__main__':
    test_passing_threshold_advances_topic()
    test_failing_first_attempt_probes_same_topic()
    test_failing_second_attempt_advances_to_next_topic()
    print('All threshold and probing unit tests passed successfully!')
