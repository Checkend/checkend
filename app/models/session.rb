class Session < ApplicationRecord
  belongs_to :user

  def current?(current_session)
    id == current_session&.id
  end

  def device_name
    return 'Unknown device' if user_agent.blank?

    case user_agent
    when /iPhone/i then 'iPhone'
    when /iPad/i then 'iPad'
    when /Android/i then 'Android'
    when /Macintosh|Mac OS/i then 'Mac'
    when /Windows/i then 'Windows'
    when /Linux/i then 'Linux'
    else 'Unknown device'
    end
  end

  def browser_name
    return 'Unknown browser' if user_agent.blank?

    # Order matters: Edge/Opera contain "Chrome" in UA, so check them first
    case user_agent
    when /Edg/i then 'Edge'
    when /OPR|Opera/i then 'Opera'
    when /Firefox/i then 'Firefox'
    when /Chrome|CriOS/i then 'Chrome'
    when /Safari/i then 'Safari'
    else 'Unknown browser'
    end
  end

  def device_description
    "#{device_name} • #{browser_name}"
  end
end
