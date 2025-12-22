class BacktraceParser
  # Parses Ruby backtrace format: "file:line:in `method'"
  # Example: "app/models/user.rb:42:in `validate_email'"
  RUBY_BACKTRACE_PATTERN = /\A(.+):(\d+):in [`'](.+)'\z/

  def self.parse(raw_lines)
    raw_lines.map { |line| parse_line(line) }.compact
  end

  def self.parse_line(line)
    return nil if line.blank?

    match = line.match(RUBY_BACKTRACE_PATTERN)
    if match
      {
        "file" => match[1],
        "line" => match[2].to_i,
        "method" => match[3]
      }
    else
      # Fallback for non-standard formats
      {
        "file" => line,
        "line" => 0,
        "method" => "unknown"
      }
    end
  end
end
