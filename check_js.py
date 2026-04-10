import sys

def check_balance(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    stack = []
    pairs = {')': '(', ']': '[', '}': '{'}
    lines = content.split('\n')
    for i, line in enumerate(lines):
        # Extremely simple quote removal to avoid false positives inside strings
        # This won't handle everything but it's a start
        in_string = False
        quote_char = None
        for j, char in enumerate(line):
            if char in ("'", '"', '`') and (j == 0 or line[j-1] != '\\'):
                if not in_string:
                    in_string = True
                    quote_char = char
                elif quote_char == char:
                    in_string = False
            
            if in_string:
                continue

            if char in pairs.values():
                stack.append((char, i + 1))
            elif char in pairs.keys():
                if not stack or stack[-1][0] != pairs[char]:
                    print(f"Mismatched or extra '{char}' found at line {i+1}")
                else:
                    stack.pop()
    
    for char, line in stack:
        print(f"Unclosed '{char}' from line {line}")

if __name__ == "__main__":
    check_balance(r"d:\DOCUMENTS\AAT2\tools\support_page\admin-dashboard.js")
